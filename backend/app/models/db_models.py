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

from sqlalchemy import Column, String, Float, DateTime, JSON, Enum as SAEnum
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
