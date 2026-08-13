"""
Data layer models. Designed around stable business concepts (quote, PO,
company account) rather than today's specific UI - so new features can
add columns or new tables without restructuring these.

Notes on extensibility choices:
- QuoteStatus / extra statuses can be added without a migration that
  touches existing rows, since it's just a string column with a Python-side
  enum for validation, not a DB-level enum constraint.
- `metadata` JSON column on each table is a pressure valve: when a new
  requirement shows up that doesn't have a column yet, it can live there
  temporarily instead of blocking on a migration.
- `company_name` is a plain string for now. When HubSpot sync becomes a
  real decision, we add a `company_id` FK to a new Company table and
  backfill it - existing code that reads `company_name` keeps working.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Float, Integer, Date, DateTime, Boolean, JSON, UniqueConstraint, Enum as SAEnum
from sqlalchemy.sql import func

from app.database import Base


def gen_id():
    return str(uuid.uuid4())


class QuoteStatus(str, enum.Enum):
    requested = "Requested"
    in_progress = "In Progress"
    on_hold = "On Hold"
    fulfilled = "Fulfilled"
    stalled = "Stalled"
    rejected = "Rejected"


class Quote(Base):
    __tablename__ = "quotes"

    id = Column(String, primary_key=True, default=gen_id)
    business_name = Column(String, nullable=False, index=True)
    requested_by = Column(String, nullable=True)
    contact_email = Column(String, nullable=True)
    contact_phone = Column(String, nullable=True)
    quote_value = Column(Float, nullable=False, default=0)
    product_brand = Column(String, nullable=True)
    date_requested = Column(DateTime, nullable=True)
    status = Column(SAEnum(QuoteStatus, native_enum=False, length=20), nullable=False, default=QuoteStatus.in_progress)
    notes = Column(String, nullable=True)
    extra = Column(JSON, nullable=True, default=dict)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class POStatus(str, enum.Enum):
    received = "Received"
    processed = "Processed"
    fulfilled = "Fulfilled"
    stalled = "Stalled"


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(String, primary_key=True, default=gen_id)
    business_name = Column(String, nullable=False, index=True)
    po_number = Column(String, nullable=True, index=True)
    ship_to = Column(String, nullable=True)
    po_value = Column(Float, nullable=False, default=0)
    date_of_po = Column(DateTime, nullable=True)
    status = Column(SAEnum(POStatus, native_enum=False, length=20), nullable=False, default=POStatus.received)
    quote_id = Column(String, nullable=True, index=True)  # optional link back to the quote it closed
    extra = Column(JSON, nullable=True, default=dict)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class AccountRegistration(Base):
    __tablename__ = "account_registrations"

    id = Column(String, primary_key=True, default=gen_id)
    business_name = Column(String, nullable=False, index=True)
    account_number = Column(String, nullable=True)
    registration_date = Column(DateTime, nullable=True)
    status = Column(String, nullable=True)
    extra = Column(JSON, nullable=True, default=dict)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ─────────────────────────────────────────────────────────────────────────
# SDR Performance dashboard
#
# These two tables are written once a day by the *separate* sdr-daily-report
# GitHub Actions pipeline (the same job that already generates the daily
# email PDF) — not by this backend. This backend only reads them.
#
# Note: `samples` is intentionally NOT a column here. Samples are a business
# record (sample_requests, with a status and an sdr_id) — structurally the
# same as quotes, not Aircall call-log data. Like quotes, the samples KPI
# is computed live from sample_requests in sdr_performance_service.py,
# attributed by created_at (when the SDR filled out the request), not
# sent_date (when it shipped, which the SDR doesn't control). One less
# thing the pipeline needs to get right.
#
# Weekly/monthly views are NOT separate tables — they're computed on read by
# aggregating rows from these two daily tables over a date range. That
# avoids a second write path that could drift out of sync with the daily
# numbers. See services/sdr_performance_service.py.
#
# `active_chunks` on SdrDailyStat is a list of booleans, one per 15-minute
# bucket of that SDR's call span for the day (True = at least one call in
# that bucket). This is the exact same bucketing sdr-daily-report's
# compute_kpis.py already does for the email's clock chart — it just needs
# to also be written here.
# ─────────────────────────────────────────────────────────────────────────

class DailySummary(Base):
    """Team-level daily totals. One row per calendar date."""
    __tablename__ = "sdr_daily_summary"

    id = Column(String, primary_key=True, default=gen_id)
    report_date = Column(Date, nullable=False, unique=True, index=True)

    calls = Column(Integer, nullable=False, default=0)
    connect_pct = Column(Float, nullable=False, default=0)
    active_hrs = Column(Float, nullable=False, default=0)

    # {"calls": {"dir": "up", "pct": 8.1}, "connect": {...}, ...} — vs the
    # prior comparable period. Computed and written by the daily pipeline,
    # not by this backend, so it stays consistent with the PDF report's math.
    deltas = Column(JSON, nullable=True, default=dict)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class SdrDailyStat(Base):
    """Per-SDR daily stats. One row per (date, sdr_name)."""
    __tablename__ = "sdr_daily_stats"

    id = Column(String, primary_key=True, default=gen_id)
    report_date = Column(Date, nullable=False, index=True)
    sdr_name = Column(String, nullable=False, index=True)

    calls = Column(Integer, nullable=False, default=0)
    connected_pct = Column(Float, nullable=False, default=0)
    voicemail_pct = Column(Float, nullable=False, default=0)
    other_pct = Column(Float, nullable=False, default=0)

    # Decimal-hour clock span, e.g. 7.9167 = 7:55 AM. Nullable because an
    # SDR with zero calls that day has no span to show.
    span_start = Column(Float, nullable=True)
    span_end = Column(Float, nullable=True)
    active_chunks = Column(JSON, nullable=True)   # list[bool], 15-min buckets
    active_hrs = Column(Float, nullable=False, default=0)
    idle_hrs = Column(Float, nullable=False, default=0)

    deltas = Column(JSON, nullable=True, default=dict)  # {"connected": {...}} — convert is derived, see sdr_performance_service.py

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("report_date", "sdr_name", name="uq_sdr_daily_stats_date_sdr"),
    )


# ─────────────────────────────────────────────────────────────────────────
# Sample Management Portal
#
# Mirrors sample-management-schema.sql, run directly against Supabase in
# production (see database.py notes — Base.metadata.create_all() does NOT
# touch production, since these tables already exist there). Locally,
# against SQLite, create_all() DOES create these tables fresh from the
# definitions below, which is what makes `npm run dev` + `uvicorn` work
# with zero setup.
#
# id generation: explicitly set in the service layer (id=gen_id()) rather
# than relied on as a column default here, on purpose — production Postgres
# defaults these to gen_random_uuid() server-side, which SQLite has no
# equivalent for. Setting it explicitly in Python works identically against
# both databases instead of requiring two different default strategies.
# ─────────────────────────────────────────────────────────────────────────

class SampleRequestStatus(str, enum.Enum):
    requested = "requested"
    sent = "sent"
    delivered = "delivered"
    on_hold = "on_hold"
    rejected = "rejected"


class AddressVerificationStatus(str, enum.Enum):
    unverified = "unverified"
    ai_verified = "ai_verified"
    human_verified = "human_verified"


class FormFieldType(str, enum.Enum):
    text = "text"
    number = "number"
    dropdown = "dropdown"
    textarea = "textarea"


class Sdr(Base):
    __tablename__ = "sdrs"

    id = Column(String, primary_key=True)
    full_name = Column(String, nullable=False, unique=True)
    active = Column(Boolean, nullable=False, default=True)
    hubspot_owner_id = Column(String, nullable=True)  # HubSpot user/owner ID, set manually per SDR
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Brand(Base):
    __tablename__ = "brands"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    color_bg = Column(String, nullable=True)
    color_text = Column(String, nullable=True)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SampleRequest(Base):
    __tablename__ = "sample_requests"

    id = Column(String, primary_key=True)
    sdr_id = Column(String, nullable=True, index=True)

    contact_name = Column(String, nullable=True)
    contact_email = Column(String, nullable=True)
    contact_phone = Column(String, nullable=True)
    business_name = Column(String, nullable=False, index=True)
    address_line = Column(String, nullable=True)
    city = Column(String, nullable=True)
    state = Column(String, nullable=True)
    zip_code = Column(String, nullable=True)

    status = Column(SAEnum(SampleRequestStatus), nullable=False, default=SampleRequestStatus.requested)
    tracking_number = Column(String, nullable=True)
    sent_date = Column(Date, nullable=True)
    delivered_date = Column(Date, nullable=True)
    assignment_note = Column(String, nullable=True)

    custom_fields = Column(JSON, nullable=False, default=dict)  # Form Builder field answers

    # Address verification (AI check — see sample_verification_service.py)
    address_verification_status = Column(SAEnum(AddressVerificationStatus), nullable=False, default=AddressVerificationStatus.unverified)
    address_verification_note = Column(String, nullable=True)
    address_verification_confidence = Column(Integer, nullable=True)
    address_verification_source_url = Column(String, nullable=True)
    address_verified_by = Column(String, nullable=True)
    address_verified_at = Column(DateTime(timezone=True), nullable=True)

    # HubSpot sync
    hubspot_contact_id = Column(String, nullable=True)
    hubspot_company_id = Column(String, nullable=True)
    hubspot_requested_synced = Column(Boolean, nullable=False, default=False)
    hubspot_sent_synced = Column(Boolean, nullable=False, default=False)
    hubspot_delivered_synced = Column(Boolean, nullable=False, default=False)
    hubspot_sync_error = Column(String, nullable=True)

    archived_at = Column(DateTime(timezone=True), nullable=True)  # soft delete
    requested_date = Column(Date, nullable=False)  # backfill-accurate date — see requested_date note in migration
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SampleRequestBrand(Base):
    """Junction table — a sample request can have more than one brand assigned."""
    __tablename__ = "sample_request_brands"

    id = Column(String, primary_key=True)
    sample_request_id = Column(String, nullable=False, index=True)
    brand_id = Column(String, nullable=False, index=True)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("sample_request_id", "brand_id", name="uq_sample_request_brand"),
    )


class FormField(Base):
    """Form Builder config. Only custom fields live here — core fields (contact
    name/email/business/address, etc.) are fixed columns on SampleRequest above,
    not builder-controlled, so they can't be edited or removed via this table."""
    __tablename__ = "form_fields"

    id = Column(String, primary_key=True)
    field_key = Column(String, nullable=False, unique=True)
    label = Column(String, nullable=False)
    field_type = Column(SAEnum(FormFieldType), nullable=False)
    options = Column(JSON, nullable=True)  # dropdown choices, e.g. ["S","M","L"]
    multiple = Column(Boolean, nullable=False, default=False)  # multi-select dropdown (e.g. Glove Type, Color) vs single-select (e.g. Size)
    required = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SampleRequestEvent(Base):
    """Audit trail — who changed what status when. Written by the service layer
    on every status transition and every batch action."""
    __tablename__ = "sample_request_events"

    id = Column(String, primary_key=True)
    sample_request_id = Column(String, nullable=False, index=True)
    from_status = Column(String, nullable=True)
    to_status = Column(String, nullable=False)
    changed_by = Column(String, nullable=True)
    note = Column(String, nullable=True)
    changed_at = Column(DateTime(timezone=True), server_default=func.now())


class CommissionSpiffRule(Base):
    """Applied SDR commission SPIFF layers, persisted by month."""
    __tablename__ = "commission_spiff_rules"

    id = Column(String, primary_key=True, default=gen_id)
    month = Column(String, nullable=False, index=True)
    prompt = Column(String, nullable=True)
    rule_json = Column(JSON, nullable=False, default=dict)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)


class CommissionDeal(Base):
    """Manually-recorded deal commissions for the SDR Commission dashboard's
    Deal Commission tab — a flat $ commission on a closed deal, either linked
    back to an existing Quote or entered as a standalone deal. Soft-deletable,
    same convention as CommissionSpiffRule."""
    __tablename__ = "commission_deals"

    id = Column(String, primary_key=True, default=gen_id)
    sdr_id = Column(String, nullable=False, index=True)
    business_name = Column(String, nullable=False)
    deal_date = Column(Date, nullable=False, index=True)
    deal_value = Column(Float, nullable=False, default=0)
    commission_pct = Column(Float, nullable=False, default=0)
    commission_amount = Column(Float, nullable=False, default=0)
    source_quote_id = Column(String, nullable=True)  # optional link back to the quote this deal closed
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)


class CommissionMeeting(Base):
    """Manually-recorded SDR/manager customer meetings for the SDR Commission
    dashboard's Meetings tab. Worth $3 like a quote, unless linked back to an
    existing Quote (source_quote_id set) — in that case it's $0, since the
    quote's own $3 already covers it. No stored dollar amount: the real,
    rule-aware amount is always computed at report time, same as
    samples/quotes. Soft-deletable, same convention as CommissionDeal."""
    __tablename__ = "commission_meetings"

    id = Column(String, primary_key=True, default=gen_id)
    sdr_id = Column(String, nullable=False, index=True)
    business_name = Column(String, nullable=False)
    meeting_date = Column(Date, nullable=False, index=True)
    source_quote_id = Column(String, nullable=True)  # set => $0 (quote already covers it); null => $3
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)


class CommissionSickDay(Base):
    """Manager-recorded SDR sick day(s) — a single date or a range, with an
    optional reason note. No dollar impact on commission; shown in the View
    List and the Excel export for record-keeping only. Soft-deletable, same
    convention as CommissionDeal."""
    __tablename__ = "commission_sick_days"

    id = Column(String, primary_key=True, default=gen_id)
    sdr_id = Column(String, nullable=False, index=True)
    start_date = Column(Date, nullable=False, index=True)
    end_date = Column(Date, nullable=False, index=True)  # == start_date for a single day
    reason_note = Column(String, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
