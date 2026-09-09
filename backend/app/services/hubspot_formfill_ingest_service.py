"""
Daily sync of SDR "form fills" — HubSpot Notes SDRs log while doing account
research. A note counts only when ALL of these are true:
  1. The Note itself was created on the target day.
  2. Its associated Company's own "Last Activity Date" (notes_last_updated)
     also falls on the target day — guards against a backdated/imported note
     where the company's real last activity is stale.
  3. The Company's lifecycle stage is one of the two prospecting stages this
     workflow is scoped to — "Researching" or "Outreach Active" — so notes
     logged on companies elsewhere in the pipeline (e.g. already a customer,
     or a sample already sent) don't count as a "form fill".

A single company can generate more than one qualifying Note the same day
(e.g. a webform-capture note plus a longer research note) — these are
merged into ONE SdrFormFill row per (company, day), not one row per note,
so the company/day is worth $5 once, not $5 per note.

Idempotent and safe to re-run for the same date: upserts SdrFormFill rows
keyed by (hubspot_company_id, fill_date), same shape as
sdr_kpi_ingest_service.ingest_day's (report_date, sdr_name) key.
"""
import html
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.services import hubspot_service
from app.models.db_models import Sdr, SdrFormFill

PST = ZoneInfo("America/Los_Angeles")

# lifecyclestage enum option values (portal-specific, confirmed via HubSpot's
# properties API — these are internal numeric IDs, not the human labels).
ELIGIBLE_LIFECYCLE_STAGES = {"4203960056", "4206319294"}  # Researching, Outreach Active


def _pst_date(iso_str: str) -> date | None:
    if not iso_str:
        return None
    # HubSpot timestamps are ISO 8601 UTC, e.g. "2026-09-08T23:44:43.247Z"
    normalized = iso_str.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return dt.astimezone(PST).date()


def _note_html_to_text(raw: str) -> str:
    """HubSpot's hs_note_body is rich-text HTML (<p>, <br>, <strong>, <a>,
    <ol><li>, wrapping <div>s). Converts it to plain text that preserves the
    paragraph/line-break structure the SDR actually sees in HubSpot, rather
    than hs_body_preview's already-flattened single-line summary. Link/bold
    markup is dropped (kept as its inner text) since this is stored as plain
    text, editable in a textarea — not rendered as HTML."""
    if not raw:
        return ""
    text = raw
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p\s*>", "\n\n", text)
    text = re.sub(r"(?i)<li[^>]*>", "• ", text)
    text = re.sub(r"(?i)</li\s*>", "\n", text)
    text = re.sub(r"(?i)<[^>]+>", "", text)  # strip all remaining tags (div, strong, a, ol...)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def ingest_day(db: Session, target_date: date) -> dict:
    day_start = datetime(target_date.year, target_date.month, target_date.day, tzinfo=PST)
    day_end = day_start + timedelta(days=1)
    start_iso = day_start.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    end_iso = day_end.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    notes = hubspot_service.search_notes_created_between(start_iso, end_iso)
    note_ids = [n["id"] for n in notes]
    note_to_company = hubspot_service.batch_get_note_company_ids(note_ids)
    company_ids = set(note_to_company.values())
    companies = hubspot_service.batch_get_companies(
        company_ids, ["name", "domain", "website", "notes_last_updated", "lifecyclestage"]
    )
    sdr_by_owner = {
        s.hubspot_owner_id: s
        for s in db.query(Sdr).filter(Sdr.hubspot_owner_id.isnot(None)).all()
    }

    skipped_no_company = 0
    skipped_stale_activity = 0
    skipped_wrong_stage = 0

    # Group every qualifying note by company — this is the merge step.
    eligible_by_company: dict[str, list[dict]] = defaultdict(list)
    for note in notes:
        note_id = note["id"]
        company_id = note_to_company.get(note_id)
        company = companies.get(company_id) if company_id else None
        if not company:
            skipped_no_company += 1
            continue

        activity_date = _pst_date(company.get("notes_last_updated"))
        if activity_date != target_date:
            skipped_stale_activity += 1
            continue

        if company.get("lifecyclestage") not in ELIGIBLE_LIFECYCLE_STAGES:
            skipped_wrong_stage += 1
            continue

        eligible_by_company[company_id].append(note)

    created_or_updated = 0
    unmapped_sdr = 0

    for company_id, company_notes in eligible_by_company.items():
        company = companies[company_id]
        # Earliest note's creator/timestamp wins for attribution — in
        # practice both notes come from the same SDR back-to-back, so this
        # is just a deterministic tie-break for the rare case they don't.
        company_notes.sort(key=lambda n: n.get("properties", {}).get("hs_createdate") or "")
        primary_props = company_notes[0].get("properties", {})
        creator_id = primary_props.get("hs_created_by_user_id")
        sdr = sdr_by_owner.get(creator_id)
        if not sdr:
            unmapped_sdr += 1

        merged_text = "\n\n———\n\n".join(
            _note_html_to_text(n.get("properties", {}).get("hs_note_body")) for n in company_notes
        )
        note_ids_for_row = [n["id"] for n in company_notes]

        row = (
            db.query(SdrFormFill)
            .filter(
                SdrFormFill.hubspot_company_id == company_id,
                SdrFormFill.fill_date == target_date,
                SdrFormFill.source == "hubspot_sync",
            )
            .first()
        )
        is_new = row is None
        if is_new:
            row = SdrFormFill(source="hubspot_sync")
            db.add(row)
        # Only set sdr_id on first ingest — a re-run must never clobber a
        # manager's manual reassignment on an already-synced row.
        if is_new and sdr:
            row.sdr_id = sdr.id
        row.company_name = company.get("name")
        row.company_domain = company.get("domain") or company.get("website")
        row.hubspot_company_id = company_id
        row.note_text = merged_text
        row.fill_date = target_date
        row.hubspot_note_ids = note_ids_for_row
        row.hubspot_creator_user_id = creator_id
        created_or_updated += 1

    db.commit()
    return {
        "date": target_date.isoformat(),
        "notes_seen": len(notes),
        "companies_recorded": created_or_updated,
        "skipped_no_company": skipped_no_company,
        "skipped_stale_activity": skipped_stale_activity,
        "skipped_wrong_stage": skipped_wrong_stage,
        "unmapped_sdr": unmapped_sdr,
    }
