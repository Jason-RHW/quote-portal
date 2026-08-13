from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.db_models import Quote, QuoteStatus, Sdr
from app.schemas.schemas import QuoteCreate, QuoteUpdate, QuoteRequestSubmit
from app.services import email_service


def list_quotes(db: Session, status: Optional[str] = None) -> List[Quote]:
    query = db.query(Quote)
    if status:
        query = query.filter(Quote.status == status)
    return query.order_by(Quote.date_requested.desc().nullslast()).all()


def get_quote(db: Session, quote_id: str) -> Optional[Quote]:
    return db.query(Quote).filter(Quote.id == quote_id).first()


def create_quote(db: Session, data: QuoteCreate) -> Quote:
    extra = data.extra or {}
    extra["line_items"] = [item.model_dump() for item in data.line_items]
    if data.associated_sdr:
        extra["associated_sdr"] = data.associated_sdr
    primary_brand = data.line_items[0].brand if data.line_items else None

    quote = Quote(
        business_name=data.business_name,
        requested_by=data.requested_by,
        contact_email=data.contact_email,
        contact_phone=data.contact_phone,
        quote_value=data.quote_value,
        product_brand=primary_brand,
        date_requested=data.date_requested,
        status=data.status,
        notes=data.notes,
        extra=extra,
    )
    db.add(quote)
    db.commit()
    db.refresh(quote)
    return quote


def create_quote_request(db: Session, data: QuoteRequestSubmit) -> Quote:
    """SDR-submitted quote request from the public sample-request-form's
    Quote Request tab — no dollar value, since pricing is filled in later
    by whoever works the quote. Brand line items are optional (the SDR may
    already know the brand(s) of interest)."""
    sdr = db.query(Sdr).filter(Sdr.id == data.sdr_id).first()
    extra = {}
    if sdr:
        extra["associated_sdr"] = sdr.full_name
    line_items = [item for item in (data.line_items or []) if item.brand]
    if line_items:
        extra["line_items"] = [item.model_dump() for item in line_items]
    primary_brand = line_items[0].brand if line_items else None

    quote = Quote(
        business_name=data.business_name,
        requested_by=data.contact_name,
        contact_email=data.contact_email,
        contact_phone=data.contact_phone,
        quote_value=0,
        product_brand=primary_brand,
        date_requested=datetime.now(timezone.utc),
        status=QuoteStatus.requested,
        notes=data.notes,
        extra=extra,
    )
    db.add(quote)
    db.commit()
    db.refresh(quote)
    return quote


def update_quote(db: Session, quote_id: str, data: QuoteUpdate) -> Optional[Quote]:
    quote = get_quote(db, quote_id)
    if not quote:
        return None

    update_data = data.model_dump(exclude_unset=True)

    if "associated_sdr" in update_data:
        extra = dict(quote.extra or {})
        sdr = update_data.pop("associated_sdr")
        if sdr:
            extra["associated_sdr"] = sdr
        else:
            extra.pop("associated_sdr", None)
        quote.extra = extra

    if "line_items" in update_data:
        line_items = update_data.pop("line_items")
        extra = dict(quote.extra or {})
        extra["line_items"] = [item.model_dump() if hasattr(item, "model_dump") else item for item in line_items]
        quote.extra = extra
        if line_items:
            first = line_items[0]
            quote.product_brand = first.brand if hasattr(first, "brand") else first.get("brand")

    for field, value in update_data.items():
        setattr(quote, field, value)

    quote.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(quote)
    return quote


def delete_quote(db: Session, quote_id: str) -> bool:
    quote = get_quote(db, quote_id)
    if not quote:
        return False
    db.delete(quote)
    db.commit()
    return True


def send_quote_request_notification_email(db: Session, quote_id: str) -> None:
    """Best-effort — mirrors send_submission_notification_email in
    sample_service.py. Never blocks or fails the SDR's submission."""
    quote = get_quote(db, quote_id)
    if not quote or not email_service.is_quote_request_configured():
        return
    try:
        email_service.send_quote_request_notification(quote)
    except email_service.EmailSendError:
        pass


def run_quote_email_notification_in_background(quote_id: str) -> None:
    """Entry point for FastAPI BackgroundTasks — opens its own DB session
    since the request-scoped one is already closed by the time this runs."""
    db = SessionLocal()
    try:
        send_quote_request_notification_email(db, quote_id)
    finally:
        db.close()
