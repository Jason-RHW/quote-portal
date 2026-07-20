from typing import Optional, List
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import verify_token, verify_sdr_token, check_sdr_code, create_sdr_token
from app.services import sample_service
from app.schemas.schemas import (
    SampleRequestCreate, SampleRequestUpdate, SampleRequestSubmit, SampleRequestOut,
    SampleRequestStatusChange, BatchStatusChange, BatchArchive, AddressVerifyConfirm,
    BrandCreate, BrandUpdate, BrandOut, SdrCreate, SdrUpdate, SdrOut,
    FormFieldCreate, FormFieldUpdate, FormFieldOut,
    SampleRequestEventOut,
)

# ─────────────────────────────────────────────────────────────────────────
# Admin router — same shared-password JWT as Quotes/POs/Accounts.
# Mounted with dependencies=[Depends(verify_token)] in main.py, same as
# the other routers, so no per-route auth wiring needed here.
# ─────────────────────────────────────────────────────────────────────────
router = APIRouter(prefix="/api/samples", tags=["samples"])


@router.get("", response_model=List[SampleRequestOut])
def list_samples(
    status: Optional[str] = None,
    sdr_id: Optional[str] = None,
    brand_id: Optional[str] = None,
    address_status: Optional[str] = None,
    include_archived: bool = False,
    db: Session = Depends(get_db),
):
    return sample_service.list_sample_requests(
        db, status=status, sdr_id=sdr_id, brand_id=brand_id,
        address_status=address_status, include_archived=include_archived,
    )


@router.post("", response_model=SampleRequestOut)
def create_sample(data: SampleRequestCreate, db: Session = Depends(get_db)):
    return sample_service.create_sample_request(db, data)


@router.get("/{request_id}", response_model=SampleRequestOut)
def get_sample(request_id: str, db: Session = Depends(get_db)):
    req = sample_service.get_sample_request(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Sample request not found")
    return req


@router.patch("/{request_id}", response_model=SampleRequestOut)
def update_sample(request_id: str, data: SampleRequestUpdate, db: Session = Depends(get_db)):
    req = sample_service.update_sample_request(db, request_id, data)
    if not req:
        raise HTTPException(status_code=404, detail="Sample request not found")
    return req


@router.post("/{request_id}/status", response_model=SampleRequestOut)
def change_status(request_id: str, data: SampleRequestStatusChange, db: Session = Depends(get_db)):
    try:
        return sample_service.change_status(db, request_id, data)
    except sample_service.StatusChangeError as e:
        msg = str(e)
        if msg == "not_found":
            raise HTTPException(status_code=404, detail="Sample request not found")
        raise HTTPException(status_code=422, detail=msg)


@router.post("/{request_id}/confirm-address", response_model=SampleRequestOut)
def confirm_address(request_id: str, data: AddressVerifyConfirm, db: Session = Depends(get_db)):
    req = sample_service.confirm_address_verified(db, request_id, data.verified_by)
    if not req:
        raise HTTPException(status_code=404, detail="Sample request not found")
    return req


@router.post("/{request_id}/verify-address", response_model=SampleRequestOut)
def verify_address(request_id: str, db: Session = Depends(get_db)):
    """Manual 'Re-run AI Check' trigger from the drawer."""
    req = sample_service.rerun_address_verification(db, request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Sample request not found")
    return req


@router.get("/{request_id}/events", response_model=List[SampleRequestEventOut])
def get_sample_events(request_id: str, db: Session = Depends(get_db)):
    return sample_service.get_events(db, request_id)


@router.post("/batch/status")
def batch_status(data: BatchStatusChange, db: Session = Depends(get_db)):
    count = sample_service.batch_change_status(db, data.ids, data.status, data.changed_by)
    return {"updated": count}


@router.post("/batch/archive")
def batch_archive(data: BatchArchive, db: Session = Depends(get_db)):
    count = sample_service.batch_archive(db, data.ids, data.changed_by)
    return {"archived": count}


@router.post("/batch/hubspot-sync")
def batch_hubspot_sync(data: BatchArchive, db: Session = Depends(get_db)):  # reuses BatchArchive's {ids, changed_by} shape
    return sample_service.batch_hubspot_sync(db, data.ids)


@router.post("/batch/address-verification")
def batch_verify_addresses(data: BatchArchive, db: Session = Depends(get_db)):  # reuses BatchArchive's {ids, changed_by} shape
    return sample_service.batch_verify_addresses(db, data.ids)


# ── Brands ──
brands_router = APIRouter(prefix="/api/brands", tags=["brands"])


@brands_router.get("", response_model=List[BrandOut])
def list_brands(include_inactive: bool = True, db: Session = Depends(get_db)):
    return sample_service.list_brands(db, include_inactive=include_inactive)


@brands_router.post("", response_model=BrandOut)
def create_brand(data: BrandCreate, db: Session = Depends(get_db)):
    return sample_service.create_brand(db, data)


@brands_router.patch("/{brand_id}", response_model=BrandOut)
def update_brand(brand_id: str, data: BrandUpdate, db: Session = Depends(get_db)):
    brand = sample_service.update_brand(db, brand_id, data)
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    return brand


# ── SDRs ──
sdrs_router = APIRouter(prefix="/api/sdrs", tags=["sdrs"])


@sdrs_router.get("", response_model=List[SdrOut])
def list_sdrs(include_inactive: bool = True, db: Session = Depends(get_db)):
    return sample_service.list_sdrs(db, include_inactive=include_inactive)


@sdrs_router.post("", response_model=SdrOut)
def create_sdr(data: SdrCreate, db: Session = Depends(get_db)):
    return sample_service.create_sdr(db, data)


@sdrs_router.patch("/{sdr_id}", response_model=SdrOut)
def update_sdr(sdr_id: str, data: SdrUpdate, db: Session = Depends(get_db)):
    sdr = sample_service.update_sdr(db, sdr_id, data)
    if not sdr:
        raise HTTPException(status_code=404, detail="SDR not found")
    return sdr


# ── Form Builder ──
form_fields_router = APIRouter(prefix="/api/form-fields", tags=["form-fields"])


@form_fields_router.get("", response_model=List[FormFieldOut])
def list_form_fields(include_inactive: bool = False, db: Session = Depends(get_db)):
    return sample_service.list_form_fields(db, include_inactive=include_inactive)


@form_fields_router.post("", response_model=FormFieldOut)
def create_form_field(data: FormFieldCreate, db: Session = Depends(get_db)):
    return sample_service.create_form_field(db, data)


@form_fields_router.patch("/{field_id}", response_model=FormFieldOut)
def update_form_field(field_id: str, data: FormFieldUpdate, db: Session = Depends(get_db)):
    field = sample_service.update_form_field(db, field_id, data)
    if not field:
        raise HTTPException(status_code=404, detail="Form field not found")
    return field


@form_fields_router.delete("/{field_id}")
def deactivate_form_field(field_id: str, db: Session = Depends(get_db)):
    if not sample_service.deactivate_form_field(db, field_id):
        raise HTTPException(status_code=404, detail="Form field not found")
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────
# Public router — the SDR-facing form. NOT protected by verify_token (the
# admin JWT). Uses its own SDR access-code login instead.
#
# Deliberately a DIFFERENT path prefix (/api/public) than the admin router
# (/api/samples), not just a different auth dependency. The admin router
# has GET /api/samples/{request_id} — a catch-all path param — and Starlette
# matches routes in registration order, so if these lived under the same
# /api/samples prefix, a request to /api/samples/sdrs-public could get
# matched against {request_id}="sdrs-public" on the ADMIN router instead of
# this one, depending on which router happened to be included first in
# main.py. A distinct prefix makes that collision structurally impossible
# rather than relying on getting the include order right (verified this
# was a real bug, not a hypothetical, before fixing it this way).
# ─────────────────────────────────────────────────────────────────────────
public_router = APIRouter(prefix="/api/public", tags=["samples-public"])


class SdrCodeRequest(BaseModel):
    code: str


class SdrTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@public_router.post("/sdr-login", response_model=SdrTokenResponse)
def sdr_login(body: SdrCodeRequest):
    if not check_sdr_code(body.code):
        raise HTTPException(status_code=401, detail="Incorrect access code")
    return SdrTokenResponse(access_token=create_sdr_token())


@public_router.get("/sdrs", response_model=List[SdrOut])
def sdrs_public(db: Session = Depends(get_db), _=Depends(verify_sdr_token)):
    """SDR roster for the request form's dropdown — needs the SDR token, not the
    admin JWT, since this is reached from the separate SDR-form frontend."""
    return sample_service.list_sdrs(db, include_inactive=False)


@public_router.get("/form-fields", response_model=List[FormFieldOut])
def form_fields_public(db: Session = Depends(get_db), _=Depends(verify_sdr_token)):
    return sample_service.list_form_fields(db, include_inactive=False)


@public_router.post("/samples/submit", response_model=SampleRequestOut)
def submit(
    data: SampleRequestSubmit,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(verify_sdr_token),
):
    req = sample_service.submit_sample_request(db, data)
    # HubSpot matching/creation runs after the response is sent so the SDR
    # doesn't wait on it; the cron-driven batch_sync_requested_to_hubspot
    # safety net catches anything this doesn't finish (see cron.py).
    background_tasks.add_task(sample_service.run_requested_sync_in_background, req.id)
    # Same non-blocking, best-effort treatment for the manager notification email.
    background_tasks.add_task(sample_service.run_email_notification_in_background, req.id)
    return req
