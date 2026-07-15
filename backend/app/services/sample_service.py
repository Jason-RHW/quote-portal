"""
Sample Management Portal — service layer.

Mirrors quote_service.py's pattern (thin router → service → SQLAlchemy).
The one meaningfully different piece is status-change gating: the UI mockup
enforces "can't mark Sent without a tracking number + sent date" client-side,
but that's a UX nicety, not a real guarantee — a direct API call could skip
right past it. change_status() below re-enforces the same rule server-side,
which is the actual source of truth.
"""
import uuid
from datetime import datetime, timezone, date
from typing import Optional, List
from sqlalchemy.orm import Session

from app.models.db_models import (
    SampleRequest, SampleRequestBrand, Brand, Sdr, FormField, SampleRequestEvent,
    SampleRequestStatus, AddressVerificationStatus,
)
from app.schemas.schemas import (
    SampleRequestCreate, SampleRequestUpdate, SampleRequestSubmit,
    SampleRequestStatusChange, BrandCreate, BrandUpdate, SdrCreate, SdrUpdate,
    FormFieldCreate, FormFieldUpdate,
)
from app.services import address_verification_service as verify_svc
from app.services import hubspot_service


def gen_id() -> str:
    return str(uuid.uuid4())


# ── Read helpers ──

def _brand_ids_for(db: Session, sample_request_id: str) -> List[str]:
    rows = db.query(SampleRequestBrand).filter(SampleRequestBrand.sample_request_id == sample_request_id).all()
    return [str(r.brand_id) for r in rows]


def _normalize_request_ids(req: SampleRequest) -> SampleRequest:
    req.id = str(req.id)
    if req.sdr_id is not None:
        req.sdr_id = str(req.sdr_id)
    req.brand_ids = [str(bid) for bid in getattr(req, "brand_ids", [])]
    return req


def _attach_brand_ids(db: Session, requests: List[SampleRequest]) -> List[SampleRequest]:
    for r in requests:
        r.brand_ids = _brand_ids_for(db, r.id)
        _normalize_request_ids(r)
    return requests


def list_sample_requests(
    db: Session,
    status: Optional[str] = None,
    sdr_id: Optional[str] = None,
    brand_id: Optional[str] = None,
    address_status: Optional[str] = None,
    include_archived: bool = False,
) -> List[SampleRequest]:
    query = db.query(SampleRequest)
    if not include_archived:
        query = query.filter(SampleRequest.archived_at.is_(None))
    if status:
        query = query.filter(SampleRequest.status == status)
    if sdr_id:
        query = query.filter(SampleRequest.sdr_id == sdr_id)
    if address_status:
        query = query.filter(SampleRequest.address_verification_status == address_status)
    if brand_id:
        matching_ids = [
            r.sample_request_id for r in
            db.query(SampleRequestBrand).filter(SampleRequestBrand.brand_id == brand_id).all()
        ]
        query = query.filter(SampleRequest.id.in_(matching_ids))

    results = query.order_by(SampleRequest.created_at.desc(), SampleRequest.requested_date.desc()).all()
    return _attach_brand_ids(db, results)


def get_sample_request(db: Session, request_id: str) -> Optional[SampleRequest]:
    req = db.query(SampleRequest).filter(SampleRequest.id == request_id).first()
    if req:
        req.brand_ids = _brand_ids_for(db, req.id)
        _normalize_request_ids(req)
    return req


def _set_brands(db: Session, request_id: str, brand_ids: List[str]):
    db.query(SampleRequestBrand).filter(SampleRequestBrand.sample_request_id == request_id).delete()
    for bid in brand_ids:
        db.add(SampleRequestBrand(id=gen_id(), sample_request_id=request_id, brand_id=bid))
        db.flush()


def _log_event(db: Session, request_id: str, from_status: Optional[str], to_status: str,
                changed_by: Optional[str] = None, note: Optional[str] = None):
    db.add(SampleRequestEvent(
        id=gen_id(), sample_request_id=request_id,
        from_status=from_status, to_status=to_status,
        changed_by=changed_by, note=note,
    ))


def _brand_names_for(db: Session, sample_request_id: str) -> List[str]:
    return [
        b.name for b in
        db.query(Brand)
        .join(SampleRequestBrand, SampleRequestBrand.brand_id == Brand.id)
        .filter(SampleRequestBrand.sample_request_id == sample_request_id)
        .order_by(Brand.name)
        .all()
    ]


def _product_sent_for(db: Session, req: SampleRequest) -> str:
    brand_names = _brand_names_for(db, req.id)
    if brand_names:
        return ", ".join(brand_names)
    custom_fields = req.custom_fields or {}
    glove_type = custom_fields.get("glove_type")
    if isinstance(glove_type, list) and glove_type:
        return ", ".join(str(v) for v in glove_type)
    if glove_type:
        return str(glove_type)
    return "Sample"


def _clear_hubspot_sync_flags(req: SampleRequest):
    req.hubspot_sent_synced = False
    req.hubspot_delivered_synced = False


def _run_verification_best_effort(db: Session, req: SampleRequest):
    """Best-effort — a failed/unconfigured AI check must never block a
    submission. On success, commits the result directly to the row."""
    result = verify_svc.verify_address(req)
    if result is None:
        return
    req.address_verification_status = result["status"]
    req.address_verification_note = result["note"]
    req.address_verification_confidence = result["confidence"]
    req.address_verification_source_url = result["source_url"]
    db.commit()
    db.refresh(req)


# ── Create (SDR-facing form — public endpoint) ──

def submit_sample_request(db: Session, data: SampleRequestSubmit) -> SampleRequest:
    req = SampleRequest(
        id=gen_id(),
        sdr_id=data.sdr_id,
        contact_name=data.contact_name,
        contact_email=data.contact_email,
        contact_phone=data.contact_phone,
        business_name=data.business_name,
        address_line=data.address_line,
        city=data.city,
        state=data.state,
        zip_code=data.zip_code,
        requested_date=data.requested_date or date.today(),
        status=SampleRequestStatus.requested,
        address_verification_status=AddressVerificationStatus.unverified,
        custom_fields=data.custom_fields or {},
    )
    db.add(req)
    db.flush()
    _log_event(db, req.id, None, SampleRequestStatus.requested.value, changed_by="SDR form")
    db.commit()
    db.refresh(req)
    req.brand_ids = []
    return _normalize_request_ids(req)


# ── Create (admin manual add — ungated dates/status, for backfill) ──

def create_sample_request(db: Session, data: SampleRequestCreate, changed_by: Optional[str] = None) -> SampleRequest:
    req = SampleRequest(
        id=gen_id(),
        sdr_id=data.sdr_id,
        contact_name=data.contact_name,
        contact_email=data.contact_email,
        contact_phone=data.contact_phone,
        business_name=data.business_name,
        address_line=data.address_line,
        city=data.city,
        state=data.state,
        zip_code=data.zip_code,
        requested_date=data.requested_date or date.today(),
        status=data.status,
        tracking_number=data.tracking_number,
        sent_date=data.sent_date,
        delivered_date=data.delivered_date,
        assignment_note=data.assignment_note,
        address_verification_status=AddressVerificationStatus.unverified,
        custom_fields=data.custom_fields or {},
    )
    db.add(req)
    db.flush()
    if data.brand_ids:
        _set_brands(db, req.id, data.brand_ids)
    _log_event(db, req.id, None, data.status.value, changed_by=changed_by or "admin (manual add)")
    db.commit()
    db.refresh(req)
    _run_verification_best_effort(db, req)
    req.brand_ids = data.brand_ids or []
    return _normalize_request_ids(req)


def update_sample_request(db: Session, request_id: str, data: SampleRequestUpdate) -> Optional[SampleRequest]:
    req = db.query(SampleRequest).filter(SampleRequest.id == request_id).first()
    if not req:
        return None

    update_data = data.model_dump(exclude_unset=True)
    brand_ids = update_data.pop("brand_ids", None)
    sync_sensitive_fields = {"tracking_number", "sent_date", "delivered_date", "custom_fields", "assignment_note"}
    should_clear_sync = bool(sync_sensitive_fields.intersection(update_data.keys())) or brand_ids is not None

    for field, value in update_data.items():
        setattr(req, field, value)

    if brand_ids is not None:
        _set_brands(db, request_id, brand_ids)

    if should_clear_sync:
        _clear_hubspot_sync_flags(req)

    req.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(req)
    req.brand_ids = _brand_ids_for(db, req.id)
    return _normalize_request_ids(req)


# ── Status change — the gated action ──

class StatusChangeError(Exception):
    pass


def change_status(db: Session, request_id: str, data: SampleRequestStatusChange) -> SampleRequest:
    req = db.query(SampleRequest).filter(SampleRequest.id == request_id).first()
    if not req:
        raise StatusChangeError("not_found")

    prev_status = req.status.value if req.status else None
    target = data.status

    if target == SampleRequestStatus.sent:
        tracking = data.tracking_number or req.tracking_number
        sent_date = data.sent_date or req.sent_date
        if not tracking or not sent_date:
            raise StatusChangeError("Tracking number and sent date are both required to mark this as Sent.")
        req.tracking_number = tracking
        req.sent_date = sent_date
        req.hubspot_sent_synced = False

    elif target == SampleRequestStatus.delivered:
        tracking = data.tracking_number or req.tracking_number
        sent_date = data.sent_date or req.sent_date
        delivered_date = data.delivered_date or req.delivered_date
        if not tracking or not sent_date:
            raise StatusChangeError("This record was never marked Sent — tracking number and sent date are required too.")
        if not delivered_date:
            raise StatusChangeError("Delivered date is required to mark this as Delivered.")
        req.tracking_number = tracking
        req.sent_date = sent_date
        req.delivered_date = delivered_date
        req.hubspot_delivered_synced = False

    # requested / on_hold / rejected — no extra data required

    if target != req.status:
        _clear_hubspot_sync_flags(req)
    req.status = target
    req.updated_at = datetime.now(timezone.utc)
    _log_event(db, request_id, prev_status, target.value, changed_by=data.changed_by)
    db.commit()
    db.refresh(req)
    req.brand_ids = _brand_ids_for(db, req.id)
    return _normalize_request_ids(req)


# ── Batch actions ──

def batch_change_status(db: Session, ids: List[str], status: SampleRequestStatus, changed_by: Optional[str] = None) -> int:
    """Bulk status change deliberately bypasses the tracking/date gate — it's meant
    for corrections and backfill, not the primary Sent/Delivered workflow, which
    should go through change_status() above so tracking info actually gets captured."""
    count = 0
    for rid in ids:
        req = db.query(SampleRequest).filter(SampleRequest.id == rid).first()
        if not req:
            continue
        prev_status = req.status.value if req.status else None
        req.status = status
        _clear_hubspot_sync_flags(req)
        req.updated_at = datetime.now(timezone.utc)
        _log_event(db, rid, prev_status, status.value, changed_by=changed_by, note="Batch status change")
        count += 1
    db.commit()
    return count


def batch_hubspot_sync(db: Session, ids: List[str]) -> dict:
    """Create HubSpot notes and update lifecycle/tracking using the legacy
    sample-sheet matching logic:
    1. Email -> contact
    2. First + last name -> contact
    3. Business name -> company
    If a contact is found, also update its associated company when available.
    """
    synced = 0
    skipped = 0
    failed = 0
    errors = []
    for rid in ids:
        req = db.query(SampleRequest).filter(SampleRequest.id == rid).first()
        if not req:
            skipped += 1
            continue
        if req.status not in (SampleRequestStatus.sent, SampleRequestStatus.delivered):
            skipped += 1
            continue
        if req.status == SampleRequestStatus.sent and not req.tracking_number:
            skipped += 1
            continue
        if req.status == SampleRequestStatus.delivered and not req.delivered_date:
            skipped += 1
            continue
        product_sent = _product_sent_for(db, req)
        try:
            result = hubspot_service.sync_sample(req, product_sent)
        except hubspot_service.HubSpotSyncError as e:
            failed += 1
            errors.append({"id": rid, "business_name": req.business_name, "error": str(e)})
            _log_event(
                db,
                rid,
                req.status.value if req.status else None,
                req.status.value if req.status else "hubspot_sync_failed",
                changed_by="HubSpot sync",
                note=f"HubSpot sync failed: {e}",
            )
            continue
        req.hubspot_contact_id = result.contact_id or req.hubspot_contact_id
        req.hubspot_company_id = result.company_id or req.hubspot_company_id
        if req.status == SampleRequestStatus.sent:
            req.hubspot_sent_synced = True
        elif req.status == SampleRequestStatus.delivered:
            req.hubspot_delivered_synced = True
        synced += 1
    db.commit()
    return {"synced": synced, "skipped": skipped, "failed": failed, "errors": errors}


def batch_verify_addresses(db: Session, ids: List[str]) -> dict:
    verified = 0
    skipped = 0
    failed = 0
    errors = []
    for rid in ids:
        req = db.query(SampleRequest).filter(SampleRequest.id == rid).first()
        if not req:
            skipped += 1
            continue
        try:
            before = req.address_verification_status
            updated = rerun_address_verification(db, rid)
            if updated:
                verified += 1
                if updated.address_verification_status != before:
                    _log_event(
                        db,
                        rid,
                        req.status.value if req.status else None,
                        req.status.value if req.status else "address_verified",
                        changed_by="AI address verification",
                        note=f"Address verification status: {updated.address_verification_status.value}",
                    )
            else:
                skipped += 1
        except Exception as e:
            failed += 1
            errors.append({"id": rid, "business_name": req.business_name, "error": str(e)})
    db.commit()
    return {"verified": verified, "skipped": skipped, "failed": failed, "errors": errors}


def batch_archive(db: Session, ids: List[str], changed_by: Optional[str] = None) -> int:
    count = 0
    now = datetime.now(timezone.utc)
    for rid in ids:
        req = db.query(SampleRequest).filter(SampleRequest.id == rid).first()
        if not req:
            continue
        req.archived_at = now
        _log_event(db, rid, req.status.value if req.status else None, req.status.value if req.status else "archived",
                    changed_by=changed_by, note="Archived (batch)")
        count += 1
    db.commit()
    return count


# ── Address verification ──

def rerun_address_verification(db: Session, request_id: str) -> Optional[SampleRequest]:
    req = db.query(SampleRequest).filter(SampleRequest.id == request_id).first()
    if not req:
        return None
    if not verify_svc.is_configured():
        req.address_verification_note = "AI check not configured — set OPENAI_API_KEY on the backend to enable this."
        db.commit()
        db.refresh(req)
        req.brand_ids = _brand_ids_for(db, req.id)
        return _normalize_request_ids(req)
    _run_verification_best_effort(db, req)
    req.brand_ids = _brand_ids_for(db, req.id)
    return _normalize_request_ids(req)


def confirm_address_verified(db: Session, request_id: str, verified_by: str) -> Optional[SampleRequest]:
    req = db.query(SampleRequest).filter(SampleRequest.id == request_id).first()
    if not req:
        return None
    req.address_verification_status = AddressVerificationStatus.human_verified
    req.address_verification_note = f"Manually confirmed by {verified_by}."
    req.address_verified_by = verified_by
    req.address_verified_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(req)
    req.brand_ids = _brand_ids_for(db, req.id)
    return _normalize_request_ids(req)


def get_events(db: Session, request_id: str) -> List[SampleRequestEvent]:
    return (
        db.query(SampleRequestEvent)
        .filter(SampleRequestEvent.sample_request_id == request_id)
        .order_by(SampleRequestEvent.changed_at.desc())
        .all()
    )


# ── Brands ──

def list_brands(db: Session, include_inactive: bool = True) -> List[Brand]:
    query = db.query(Brand)
    if not include_inactive:
        query = query.filter(Brand.active.is_(True))
    return query.order_by(Brand.name).all()


def create_brand(db: Session, data: BrandCreate) -> Brand:
    brand = Brand(id=gen_id(), **data.model_dump())
    db.add(brand)
    db.commit()
    db.refresh(brand)
    return brand


def update_brand(db: Session, brand_id: str, data: BrandUpdate) -> Optional[Brand]:
    brand = db.query(Brand).filter(Brand.id == brand_id).first()
    if not brand:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(brand, field, value)
    db.commit()
    db.refresh(brand)
    return brand


# ── SDRs ──

def list_sdrs(db: Session, include_inactive: bool = True) -> List[Sdr]:
    query = db.query(Sdr)
    if not include_inactive:
        query = query.filter(Sdr.active.is_(True))
    return query.order_by(Sdr.full_name).all()


def create_sdr(db: Session, data: SdrCreate) -> Sdr:
    sdr = Sdr(id=gen_id(), **data.model_dump())
    db.add(sdr)
    db.commit()
    db.refresh(sdr)
    return sdr


def update_sdr(db: Session, sdr_id: str, data: SdrUpdate) -> Optional[Sdr]:
    sdr = db.query(Sdr).filter(Sdr.id == sdr_id).first()
    if not sdr:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(sdr, field, value)
    db.commit()
    db.refresh(sdr)
    return sdr


# ── Form fields (Form Builder) ──

def list_form_fields(db: Session, include_inactive: bool = False) -> List[FormField]:
    query = db.query(FormField)
    if not include_inactive:
        query = query.filter(FormField.active.is_(True))
    return query.order_by(FormField.sort_order).all()


def create_form_field(db: Session, data: FormFieldCreate) -> FormField:
    field = FormField(id=gen_id(), **data.model_dump())
    db.add(field)
    db.commit()
    db.refresh(field)
    return field


def update_form_field(db: Session, field_id: str, data: FormFieldUpdate) -> Optional[FormField]:
    field = db.query(FormField).filter(FormField.id == field_id).first()
    if not field:
        return None
    for f, value in data.model_dump(exclude_unset=True).items():
        setattr(field, f, value)
    db.commit()
    db.refresh(field)
    return field


def deactivate_form_field(db: Session, field_id: str) -> bool:
    """'Removing' a field sets active=False rather than deleting it, so
    historical submissions keep their answers even after a field is retired."""
    field = db.query(FormField).filter(FormField.id == field_id).first()
    if not field:
        return False
    field.active = False
    db.commit()
    return True
