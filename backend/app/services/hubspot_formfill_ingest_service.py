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
     or a sample already sent) don't count as a "form fill". This stage gate
     only applies for target_date < OUTREACH_FORMAT_CUTOFF (legacy dates with
     no structured note to judge eligibility from another way) — see point 5.
  4. The Note has a real human creator (hs_created_by_user_id is set). Notes
     with no creator are written by an API/integration, not a person doing
     research — e.g. this app's own outbound HubSpot sync logs a "Sample
     Project Batch #… Sample Sent: <SKU>" note when a sample ships, which is
     record-keeping, not SDR work, and should never count as a form fill.
  5. For target_date >= OUTREACH_FORMAT_CUTOFF (2026-09-11, when SDRs
     started using this template): at least one of that day's notes on the
     company must match the structured
       Email: <Sent|Not Sent|Bounced>
       Web Form: <Submitted|No Form|Failed|Not Submitted>
       Status: <...>
       Notes/Reason: <...>
     format — see _parse_outreach_note. A plain research note with no such
     template still doesn't count on/after this date. Every company whose
     note matches the template gets a row **regardless of lifecycle stage**
     (DQ'd/no-email-sent ones included, visible for tracking) — a company
     that gets disqualified is routinely moved to the "Disqualified Lead"
     stage by the SDR at the same time, so gating on stage here would
     silently drop every DQ row, defeating the point of showing it. Its
     canonical status is stored in outreach_status and only "Email +
     Webform"/"Email" earn the $ rate; see spiff_service._form_fill_rate_for
     for the commission gate. Company/day pairs that no longer have any
     template-matching note on a re-run are actively removed (soft-deleted),
     not just skipped, so re-syncing after this rule shipped correctly
     retracts anything wrongly counted before it existed.

Each row also carries the company's current HubSpot lifecycle-stage label
(lifecycle_stage), refreshed live on every Form Fills page load (see
refresh_lifecycle_stages / form_fill_service.list_form_fills) so it reflects
HubSpot in near-real time rather than only the value at sync time.

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
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.services import hubspot_service
from app.models.db_models import Sdr, SdrFormFill

PST = ZoneInfo("America/Los_Angeles")

# lifecyclestage enum option values (portal-specific, confirmed via HubSpot's
# properties API — these are internal numeric IDs, not the human labels).
ELIGIBLE_LIFECYCLE_STAGES = {"4203960056", "4206319294"}  # Researching, Outreach Active

# Full lifecyclestage enum -> human label (portal-specific, confirmed via
# HubSpot's properties API) — used to display each row's current stage on
# the Form Fills page regardless of whether that stage is "eligible" above.
LIFECYCLE_STAGE_LABELS = {
    "lead": "Lead",
    "3467914943": "Contacted Lead",
    "3442855634": "Voicemail",
    "3570774768": "2nd Outreach",
    "3570774769": "3rd Outreach",
    "3570774770": "4th Outreach",
    "other": "Other",
    "3401724618": "Disqualified Lead",
    "3401728724": "Not Interested",
    "opportunity": "Sales Opportunity",
    "subscriber": "Sample Request",
    "3634488044": "Sample Sent",
    "3631125214": "Sample Delivered",
    "3632110305": "Meeting Scheduled",
    "3634624214": "Quotation",
    "3774270182": "Sample Received — Pending Review",
    "3610401495": "1st Follow-up (After Sample)",
    "3610401496": "2nd Follow-up (After Sample)",
    "3465713347": "Active Customer",
    "3467914944": "Repeat Customer",
    "3468617413": "Do Not Call",
    "marketingqualifiedlead": "Marketing Qualified Lead",
    "salesqualifiedlead": "Sales Qualified Lead",
    "customer": "Customer",
    "4203970241": "Sample Project Sent",
    "4203960057": "Sample Project Delivered",
    "4203960056": "Researching",
    "4206319294": "Outreach Active",
    "4203965131": "Decision Maker Identified",
    "4203994833": "Evaluation / Qualification",
    "4249983715": "Website Issue",
}


def _lifecycle_stage_label(raw_value: Optional[str]) -> Optional[str]:
    if not raw_value:
        return None
    return LIFECYCLE_STAGE_LABELS.get(raw_value, raw_value)

# SDRs started logging a structured Email/Web Form/Status/Notes-Reason note
# on this date — see module docstring point 5.
OUTREACH_FORMAT_CUTOFF = date(2026, 9, 11)

# The 5 canonical buckets shown on the Form Fills page / used for filtering.
# Only these two earn the commission $ rate — see spiff_service.
QUALIFYING_OUTREACH_STATUSES = {"Email + Webform", "Email"}

_EMAIL_LINE_RE = re.compile(r"(?im)^\s*Email\s*:\s*(.+?)\s*$")
_WEBFORM_LINE_RE = re.compile(r"(?im)^\s*Web\s*Form\s*:\s*(.+?)\s*$")
_STATUS_LINE_RE = re.compile(r"(?im)^\s*Status\s*:\s*(.+?)\s*$")


def _parse_outreach_note(note_text: str) -> Optional[dict]:
    """Returns {"email": ..., "webform": ..., "status": ...} if this note's
    plain text matches the Email:/Status: template, else None if it's not
    that format at all (e.g. a plain research note)."""
    email_match = _EMAIL_LINE_RE.search(note_text or "")
    status_match = _STATUS_LINE_RE.search(note_text or "")
    if not email_match or not status_match:
        return None
    webform_match = _WEBFORM_LINE_RE.search(note_text or "")
    return {
        "email": email_match.group(1).strip(),
        "webform": webform_match.group(1).strip() if webform_match else "",
        "status": status_match.group(1).strip(),
    }


def _canonical_outreach_status(parsed: dict) -> str:
    """Maps this note onto one of the 5 fixed buckets shown on the Form
    Fills page. Derived primarily from the Email:/Web Form: field values —
    SDRs use fixed vocabulary there ("Sent"/"Submitted"/...) — rather than
    the free-typed Status: line, which varies ("Email Only" vs "Email",
    "Form only" instead of "Web Form Only", etc.) and would otherwise
    fragment the same outcome into different buckets. DQ/"To call" are
    exceptions: they're only ever expressed in the Status line, so that's
    checked first. "disq" (not just "dq") catches SDRs spelling out
    "Disqualified"/"DISQALIFIED" (typo seen in real data) instead of the
    abbreviation — "disq" is common to both the correct and misspelled
    forms."""
    raw_status = re.sub(r"\s+", " ", (parsed.get("status") or "").strip().lower())
    if "dq" in raw_status or "disq" in raw_status:
        return "DQ"
    if "call" in raw_status:
        return "To Call"

    email_sent = (parsed.get("email") or "").strip().lower() == "sent"
    webform_submitted = (parsed.get("webform") or "").strip().lower() == "submitted"
    if email_sent and webform_submitted:
        return "Email + Webform"
    if email_sent:
        return "Email"
    if webform_submitted:
        return "Webform"
    # Neither field value was recognized (e.g. Web Form: line missing
    # entirely) — fall back to loose keyword matching on the Status text
    # rather than silently dropping data.
    has_email = "email" in raw_status
    has_webform = "form" in raw_status
    if has_email and has_webform:
        return "Email + Webform"
    if has_email:
        return "Email"
    if has_webform:
        return "Webform"
    return parsed.get("status") or "Unknown"


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

    # For target_date >= cutoff, the outreach template match (point 5) is
    # what determines eligibility, not lifecycle stage — see module
    # docstring. Computed up front so the stage gate below can be skipped.
    requires_outreach_format = target_date >= OUTREACH_FORMAT_CUTOFF

    skipped_no_company = 0
    skipped_stale_activity = 0
    skipped_wrong_stage = 0
    skipped_no_creator = 0

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

        if not requires_outreach_format and company.get("lifecyclestage") not in ELIGIBLE_LIFECYCLE_STAGES:
            skipped_wrong_stage += 1
            continue

        if not note.get("properties", {}).get("hs_created_by_user_id"):
            skipped_no_creator += 1
            continue

        eligible_by_company[company_id].append(note)

    # For target_date >= cutoff, every row needs a canonical outreach status
    # from the template — find the earliest template-matching note in each
    # company's group (None if none of that day's notes use the template).
    skipped_no_outreach_match = 0
    outreach_status_by_company: dict[str, str] = {}
    if requires_outreach_format:
        for company_id in list(eligible_by_company.keys()):
            company_notes = sorted(
                eligible_by_company[company_id],
                key=lambda n: n.get("properties", {}).get("hs_createdate") or "",
            )
            parsed = None
            for n in company_notes:
                parsed = _parse_outreach_note(_note_html_to_text(n.get("properties", {}).get("hs_note_body")))
                if parsed:
                    break
            if not parsed:
                del eligible_by_company[company_id]
                skipped_no_outreach_match += 1
                continue
            outreach_status_by_company[company_id] = _canonical_outreach_status(parsed)

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
        row.outreach_status = outreach_status_by_company.get(company_id)
        row.lifecycle_stage = _lifecycle_stage_label(company.get("lifecyclestage"))
        created_or_updated += 1

    removed_no_longer_qualifying = 0
    if requires_outreach_format:
        # Retroactive correction: a row synced before this rule existed (or
        # before a company's note was edited to no longer match the
        # template) needs to be retracted on re-run, not just skipped
        # going forward.
        stale_rows = (
            db.query(SdrFormFill)
            .filter(
                SdrFormFill.fill_date == target_date,
                SdrFormFill.source == "hubspot_sync",
                SdrFormFill.deleted_at.is_(None),
            )
            .all()
        )
        now = datetime.now(ZoneInfo("UTC"))
        for row in stale_rows:
            if row.hubspot_company_id not in eligible_by_company:
                row.deleted_at = now
                removed_no_longer_qualifying += 1

    db.commit()
    return {
        "date": target_date.isoformat(),
        "notes_seen": len(notes),
        "companies_recorded": created_or_updated,
        "skipped_no_company": skipped_no_company,
        "skipped_stale_activity": skipped_stale_activity,
        "skipped_wrong_stage": skipped_wrong_stage,
        "skipped_no_creator": skipped_no_creator,
        "skipped_no_outreach_match": skipped_no_outreach_match,
        "removed_no_longer_qualifying": removed_no_longer_qualifying,
        "unmapped_sdr": unmapped_sdr,
    }


def refresh_lifecycle_stages(db: Session, rows: list[SdrFormFill]) -> int:
    """Live-refreshes lifecycle_stage on the given rows from HubSpot's
    current company data — called on every Form Fills page load (see
    form_fill_service.list_form_fills) so the column reflects a lifecycle
    change (e.g. a company later getting disqualified) without waiting for
    the next day's cron sync. Returns the number of rows actually changed."""
    company_ids = {row.hubspot_company_id for row in rows if row.hubspot_company_id}
    if not company_ids:
        return 0
    companies = hubspot_service.batch_get_companies(company_ids, ["lifecyclestage"])
    changed = 0
    for row in rows:
        if not row.hubspot_company_id:
            continue
        company = companies.get(row.hubspot_company_id)
        if company is None:
            continue
        new_label = _lifecycle_stage_label(company.get("lifecyclestage"))
        if new_label != row.lifecycle_stage:
            row.lifecycle_stage = new_label
            changed += 1
    if changed:
        db.commit()
    return changed
