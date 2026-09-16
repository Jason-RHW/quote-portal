"""
SDR Form Fills — CRUD for the standalone Form Fills page. Rows are mostly
populated by the daily HubSpot sync (hubspot_formfill_ingest_service.py,
source="hubspot_sync"), but a manager can also reassign the SDR on a synced
row, correct its details, add one manually (source="manual"), or delete a
bad/duplicate entry. Mirrors sample_service.py's thin router->service shape.
"""
from datetime import date, datetime
from typing import Optional, List

from sqlalchemy.orm import Session

from app.models.db_models import SdrFormFill, Sdr, gen_id


def list_form_fills(
    db: Session,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    sdr_id: Optional[str] = None,
) -> List[SdrFormFill]:
    query = db.query(SdrFormFill).filter(SdrFormFill.deleted_at.is_(None))
    if start_date:
        query = query.filter(SdrFormFill.fill_date >= start_date)
    if end_date:
        query = query.filter(SdrFormFill.fill_date <= end_date)
    if sdr_id:
        query = query.filter(SdrFormFill.sdr_id == sdr_id)
    rows = query.order_by(SdrFormFill.fill_date.desc(), SdrFormFill.created_at.desc()).all()

    # Live-refresh each visible row's lifecycle stage from HubSpot so the
    # column reflects a stage change (e.g. later disqualified) without
    # waiting for the next day's cron sync.
    from app.services import hubspot_formfill_ingest_service
    try:
        hubspot_formfill_ingest_service.refresh_lifecycle_stages(db, rows)
    except Exception:
        pass  # best-effort — a HubSpot hiccup shouldn't break the page

    return rows


def create_form_fill(db: Session, data: dict, created_by: Optional[str] = None) -> SdrFormFill:
    sdr_id = data.get("sdr_id")
    if sdr_id and not db.query(Sdr).filter(Sdr.id == sdr_id).first():
        raise ValueError("Unknown SDR.")
    company_name = (data.get("company_name") or "").strip()
    if not company_name:
        raise ValueError("Company name is required.")
    if not data.get("fill_date"):
        raise ValueError("Fill date is required.")
    row = SdrFormFill(
        id=gen_id(),
        sdr_id=sdr_id,
        company_name=company_name,
        note_text=data.get("note_text"),
        fill_date=data["fill_date"],
        source="manual",
        created_by=created_by,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_form_fill(db: Session, form_fill_id: str, data: dict) -> Optional[SdrFormFill]:
    row = db.query(SdrFormFill).filter(SdrFormFill.id == form_fill_id, SdrFormFill.deleted_at.is_(None)).first()
    if not row:
        return None
    if "sdr_id" in data:
        sdr_id = data["sdr_id"]
        if sdr_id and not db.query(Sdr).filter(Sdr.id == sdr_id).first():
            raise ValueError("Unknown SDR.")
        row.sdr_id = sdr_id
    if "company_name" in data and data["company_name"] is not None:
        row.company_name = data["company_name"].strip()
    if "note_text" in data:
        row.note_text = data["note_text"]
    if "outreach_status" in data:
        row.outreach_status = data["outreach_status"]
    if "fill_date" in data and data["fill_date"] is not None:
        row.fill_date = data["fill_date"]
    db.commit()
    db.refresh(row)
    return row


def delete_form_fill(db: Session, form_fill_id: str) -> bool:
    row = db.query(SdrFormFill).filter(SdrFormFill.id == form_fill_id, SdrFormFill.deleted_at.is_(None)).first()
    if not row:
        return False
    row.deleted_at = datetime.now()
    db.commit()
    return True
