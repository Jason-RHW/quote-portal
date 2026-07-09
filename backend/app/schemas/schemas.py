from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, computed_field, model_validator

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
