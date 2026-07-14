from datetime import datetime, date
from typing import Optional, Dict, Any, List
from uuid import UUID
from pydantic import BaseModel, computed_field, field_validator, model_validator

from app.models.db_models import QuoteStatus


class LineItem(BaseModel):
    brand: str
    sku: Optional[str] = None
    cases: Optional[int] = None


class QuoteBase(BaseModel):
    business_name: str
    requested_by: Optional[str] = None
    quote_value: float = 0
    product_brand: Optional[str] = None
    date_requested: Optional[datetime] = None
    status: QuoteStatus = QuoteStatus.in_progress
    extra: Optional[Dict[str, Any]] = None


class QuoteCreate(BaseModel):
    business_name: str
    requested_by: str
    quote_value: float
    date_requested: datetime
    status: QuoteStatus = QuoteStatus.in_progress
    line_items: List[LineItem]
    associated_sdr: Optional[str] = None   # stored in extra — no migration needed
    extra: Optional[Dict[str, Any]] = None

    @model_validator(mode="after")
    def validate_line_items(self):
        if not self.line_items:
            raise ValueError("At least one brand line item is required")
        for i, item in enumerate(self.line_items):
            if not item.brand:
                raise ValueError(f"Brand is required for line item {i + 1}")
        return self


class QuoteUpdate(BaseModel):
    business_name: Optional[str] = None
    requested_by: Optional[str] = None
    quote_value: Optional[float] = None
    product_brand: Optional[str] = None
    date_requested: Optional[datetime] = None
    status: Optional[QuoteStatus] = None
    line_items: Optional[List[LineItem]] = None
    associated_sdr: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None


class QuoteOut(BaseModel):
    id: str
    business_name: str
    requested_by: Optional[str] = None
    quote_value: float
    product_brand: Optional[str] = None
    date_requested: Optional[datetime] = None
    status: QuoteStatus
    extra: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def line_items(self) -> List[LineItem]:
        if self.extra and "line_items" in self.extra:
            return [LineItem(**item) for item in self.extra["line_items"]]
        if self.product_brand:
            return [LineItem(brand=self.product_brand)]
        return []

    @computed_field
    @property
    def associated_sdr(self) -> Optional[str]:
        return (self.extra or {}).get("associated_sdr")

    class Config:
        from_attributes = True


class POBase(BaseModel):
    business_name: str
    po_value: float = 0
    date_of_po: Optional[datetime] = None
    quote_id: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None


class POCreate(POBase):
    associated_sdr: Optional[str] = None   # stored in extra — no migration needed


class POUpdate(BaseModel):
    business_name: Optional[str] = None
    po_value: Optional[float] = None
    date_of_po: Optional[datetime] = None
    quote_id: Optional[str] = None
    associated_sdr: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None


class POOut(POBase):
    id: str
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def associated_sdr(self) -> Optional[str]:
        return (self.extra or {}).get("associated_sdr")

    class Config:
        from_attributes = True


class AccountRegBase(BaseModel):
    business_name: str
    account_number: Optional[str] = None
    registration_date: Optional[datetime] = None
    status: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None


class AccountRegCreate(AccountRegBase):
    pass


class AccountRegUpdate(BaseModel):
    business_name: Optional[str] = None
    account_number: Optional[str] = None
    registration_date: Optional[datetime] = None
    status: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None


class AccountRegOut(AccountRegBase):
    id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DashboardSummary(BaseModel):
    total_quotes: int
    total_quote_value: float
    avg_quote_value: float
    by_status: Dict[str, int]
    stalled_count: int
    total_po_value: float
    total_accounts: int


# ─────────────────────────────────────────────────────────────────────────
# SDR Performance dashboard
#
# Shaped to match the frontend mockup's REPORTS[granularity][key] object
# directly — same field names (calls, connect, convert, samples, activeHrs,
# quotes, mix, clock, span8) so the React port is a mechanical translation,
# not a redesign of the data contract.
# ─────────────────────────────────────────────────────────────────────────

class DeltaOut(BaseModel):
    dir: str    # "up" | "down"
    pct: float


class TeamKpiOut(BaseModel):
    calls: int
    connect: float
    convert: float
    samples: int
    activeHrs: float
    quotes: int
    deltas: Dict[str, DeltaOut]


class SdrMixOut(BaseModel):
    connected: float
    voicemail: float
    other: float
    connectedDelta: Optional[DeltaOut] = None
    voicemailDelta: Optional[DeltaOut] = None
    otherDelta: Optional[DeltaOut] = None


class SdrClockOut(BaseModel):
    timeLabel: str
    start: float
    end: float
    idle: List[int]      # indices of inactive 15-min chunks
    activeHrs: float
    idleHrs: float


class SdrSpan8Out(BaseModel):
    active: float
    idle: float


class StatWithDelta(BaseModel):
    v: float
    delta: Optional[DeltaOut] = None


class SdrRowOut(BaseModel):
    name: str
    calls: int
    mix: SdrMixOut
    samples: StatWithDelta
    convert: StatWithDelta
    quotes: StatWithDelta
    clock: Optional[SdrClockOut] = None   # present for daily
    span8: Optional[SdrSpan8Out] = None   # present for weekly/monthly


class SdrPerformanceReportOut(BaseModel):
    note: Optional[str] = None
    team: TeamKpiOut
    sdrs: List[SdrRowOut]


class AvailablePeriodsOut(BaseModel):
    daily: List[str]
    weekly: List[str]
    monthly: List[str]


# ─────────────────────────────────────────────────────────────────────────
# Sample Management Portal
# ─────────────────────────────────────────────────────────────────────────
from app.models.db_models import SampleRequestStatus, AddressVerificationStatus, FormFieldType


def stringify_uuid(value):
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, list):
        return [stringify_uuid(item) for item in value]
    return value


class SdrOut(BaseModel):
    id: str
    full_name: str
    active: bool

    _stringify_ids = field_validator("id", mode="before")(stringify_uuid)

    class Config:
        from_attributes = True


class SdrCreate(BaseModel):
    full_name: str
    active: bool = True


class SdrUpdate(BaseModel):
    full_name: Optional[str] = None
    active: Optional[bool] = None


class BrandBase(BaseModel):
    name: str
    color_bg: Optional[str] = None
    color_text: Optional[str] = None
    active: bool = True


class BrandCreate(BrandBase):
    pass


class BrandUpdate(BaseModel):
    name: Optional[str] = None
    color_bg: Optional[str] = None
    color_text: Optional[str] = None
    active: Optional[bool] = None


class BrandOut(BrandBase):
    id: str
    created_at: datetime

    _stringify_ids = field_validator("id", mode="before")(stringify_uuid)

    class Config:
        from_attributes = True


class FormFieldBase(BaseModel):
    field_key: str
    label: str
    field_type: FormFieldType
    options: Optional[List[str]] = None
    multiple: bool = False
    required: bool = False
    sort_order: int = 0
    active: bool = True


class FormFieldCreate(FormFieldBase):
    pass


class FormFieldUpdate(BaseModel):
    label: Optional[str] = None
    field_type: Optional[FormFieldType] = None
    options: Optional[List[str]] = None
    multiple: Optional[bool] = None
    required: Optional[bool] = None
    sort_order: Optional[int] = None
    active: Optional[bool] = None


class FormFieldOut(FormFieldBase):
    id: str
    created_at: datetime

    _stringify_ids = field_validator("id", mode="before")(stringify_uuid)

    class Config:
        from_attributes = True


# ── SDR-facing submission (public endpoint, gated by SDR access code, not admin JWT) ──
class SampleRequestSubmit(BaseModel):
    sdr_id: Optional[str] = None   # None allowed — "None" option on the form
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    business_name: str
    address_line: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    requested_date: Optional[date] = None  # defaults to today if omitted
    custom_fields: Optional[Dict[str, Any]] = None


# ── Admin manual add — same fields, plus everything backfill needs, ungated ──
class SampleRequestCreate(BaseModel):
    sdr_id: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    business_name: str
    address_line: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    requested_date: Optional[date] = None
    status: SampleRequestStatus = SampleRequestStatus.requested
    tracking_number: Optional[str] = None
    sent_date: Optional[date] = None
    delivered_date: Optional[date] = None
    assignment_note: Optional[str] = None
    brand_ids: Optional[List[str]] = None
    custom_fields: Optional[Dict[str, Any]] = None


class SampleRequestUpdate(BaseModel):
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    business_name: Optional[str] = None
    address_line: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    tracking_number: Optional[str] = None
    sent_date: Optional[date] = None
    delivered_date: Optional[date] = None
    assignment_note: Optional[str] = None
    brand_ids: Optional[List[str]] = None
    custom_fields: Optional[Dict[str, Any]] = None


# ── Status change — the gated action. tracking_number/sent_date required
# going to "sent"; delivered_date required going to "delivered" (and
# tracking/sent too, if the record skipped "sent" entirely). Enforced
# server-side in the service layer, not just trusted from the frontend. ──
class SampleRequestStatusChange(BaseModel):
    status: SampleRequestStatus
    tracking_number: Optional[str] = None
    sent_date: Optional[date] = None
    delivered_date: Optional[date] = None
    changed_by: Optional[str] = None


class BatchStatusChange(BaseModel):
    ids: List[str]
    status: SampleRequestStatus
    changed_by: Optional[str] = None


class BatchArchive(BaseModel):
    ids: List[str]
    changed_by: Optional[str] = None


class AddressVerifyConfirm(BaseModel):
    verified_by: str


class SampleRequestOut(BaseModel):
    id: str
    sdr_id: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    business_name: Optional[str] = None
    address_line: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    status: SampleRequestStatus
    tracking_number: Optional[str] = None
    sent_date: Optional[date] = None
    delivered_date: Optional[date] = None
    assignment_note: Optional[str] = None
    custom_fields: Dict[str, Any] = {}
    address_verification_status: AddressVerificationStatus
    address_verification_note: Optional[str] = None
    address_verification_confidence: Optional[int] = None
    address_verification_source_url: Optional[str] = None
    address_verified_by: Optional[str] = None
    address_verified_at: Optional[datetime] = None
    hubspot_sent_synced: bool
    hubspot_delivered_synced: bool
    archived_at: Optional[datetime] = None
    requested_date: date
    created_at: datetime
    updated_at: datetime
    brand_ids: List[str] = []

    _stringify_ids = field_validator("id", "sdr_id", "brand_ids", mode="before")(stringify_uuid)

    class Config:
        from_attributes = True


class SampleRequestEventOut(BaseModel):
    id: str
    sample_request_id: str
    from_status: Optional[str] = None
    to_status: str
    changed_by: Optional[str] = None
    note: Optional[str] = None
    changed_at: datetime

    _stringify_ids = field_validator("id", "sample_request_id", mode="before")(stringify_uuid)

    class Config:
        from_attributes = True
