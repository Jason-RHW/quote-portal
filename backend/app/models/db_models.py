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
    in_progress = "In Progress"
    fulfilled = "Fulfilled"
    stalled = "Stalled"


class Quote(Base):
    __tablename__ = "quotes"

    id = Column(String, primary_key=True, default=gen_id)
    business_name = Column(String, nullable=False, index=True)
    requested_by = Column(String, nullable=True)
    quote_value = Column(Float, nullable=False, default=0)
    product_brand = Column(String, nullable=True)
    date_requested = Column(DateTime, nullable=True)
    status = Column(SAEnum(QuoteStatus), nullable=False, default=QuoteStatus.in_progress)
    extra = Column(JSON, nullable=True, default=dict)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(String, primary_key=True, default=gen_id)
    business_name = Column(String, nullable=False, index=True)
    po_value = Column(Float, nullable=False, default=0)
    date_of_po = Column(DateTime, nullable=True)
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
# Sample Management Portal — read-only models
#
# These tables are created directly by sample-management-schema.sql, NOT
# by this backend's Base.metadata.create_all() — Sample Portal's own app
# (the form, the admin console) hasn't been built yet and may or may not
# end up living in this backend. Only the two columns the SDR Performance
# dashboard actually needs are modeled here; brands, form_fields, and the
# junction table aren't, since nothing in this backend reads them.
#
# Note on id types: these tables use native Postgres `uuid` columns (via
# gen_random_uuid()), not the String-based UUIDs this backend's other
# models use (Quote, PurchaseOrder, etc., which store uuid4() as text).
# That's fine — psycopg2 returns native uuid columns as Python uuid.UUID
# objects regardless of the SQLAlchemy column type declared below, and
# joins/dict-lookups between two uuid.UUID objects work correctly. Verified
# against a real Postgres instance before shipping this, not assumed.
# ─────────────────────────────────────────────────────────────────────────

class Sdr(Base):
    __tablename__ = "sdrs"

    id = Column(String, primary_key=True)
    full_name = Column(String, nullable=False, unique=True)
    active = Column(Boolean, nullable=False, default=True)


class SampleRequest(Base):
    __tablename__ = "sample_requests"

    id = Column(String, primary_key=True)
    sdr_id = Column(String, nullable=True)
    status = Column(String, nullable=False, default="requested")
    created_at = Column(DateTime, nullable=False)  # KPI attribution date — when the SDR filled the form
