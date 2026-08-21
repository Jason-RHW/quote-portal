"""
Idempotent, startup-time schema patches for columns/type changes that
Base.metadata.create_all() can't apply to an already-existing table (it
only creates missing tables, never alters existing ones).

Each statement runs in its own transaction and is wrapped in a broad
try/except, so one failing/already-applied statement never aborts the
others or blocks the app from booting — worst case, that particular
column/conversion stays pending until this runs successfully again on
a later boot.
"""
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.database import is_sqlite


def _run(engine: Engine, statement: str) -> None:
    try:
        with engine.begin() as conn:
            conn.execute(text(statement))
    except Exception:
        pass


def _add_column_if_missing(engine: Engine, table: str, column: str, sqlite_ddl: str, postgres_ddl: str) -> None:
    if is_sqlite:
        with engine.begin() as conn:
            existing = [row[1] for row in conn.execute(text(f"PRAGMA table_info({table})")).all()]
        if column not in existing:
            _run(engine, sqlite_ddl)
    else:
        _run(engine, postgres_ddl)


def run(engine: Engine) -> None:
    _add_column_if_missing(
        engine, "quotes", "contact_email",
        "ALTER TABLE quotes ADD COLUMN contact_email VARCHAR",
        "ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contact_email VARCHAR",
    )
    _add_column_if_missing(
        engine, "quotes", "contact_phone",
        "ALTER TABLE quotes ADD COLUMN contact_phone VARCHAR",
        "ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contact_phone VARCHAR",
    )
    _add_column_if_missing(
        engine, "quotes", "notes",
        "ALTER TABLE quotes ADD COLUMN notes VARCHAR",
        "ALTER TABLE quotes ADD COLUMN IF NOT EXISTS notes VARCHAR",
    )

    _add_column_if_missing(
        engine, "purchase_orders", "po_number",
        "ALTER TABLE purchase_orders ADD COLUMN po_number VARCHAR",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_number VARCHAR",
    )
    _add_column_if_missing(
        engine, "purchase_orders", "ship_to",
        "ALTER TABLE purchase_orders ADD COLUMN ship_to VARCHAR",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS ship_to VARCHAR",
    )
    # Default is the enum MEMBER NAME ("received"), not its display value
    # ("Received") — SQLAlchemy's Enum(native_enum=False) stores/reads by
    # name, matching how quotes.status already stores e.g. "in_progress".
    _add_column_if_missing(
        engine, "purchase_orders", "status",
        "ALTER TABLE purchase_orders ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'received'",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'received'",
    )

    _add_column_if_missing(
        engine, "sample_requests", "carrier",
        "ALTER TABLE sample_requests ADD COLUMN carrier VARCHAR",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS carrier VARCHAR",
    )
    _add_column_if_missing(
        engine, "sample_requests", "tracking_status",
        "ALTER TABLE sample_requests ADD COLUMN tracking_status VARCHAR",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS tracking_status VARCHAR",
    )
    _add_column_if_missing(
        engine, "sample_requests", "tracking_status_detail",
        "ALTER TABLE sample_requests ADD COLUMN tracking_status_detail VARCHAR",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS tracking_status_detail VARCHAR",
    )
    _add_column_if_missing(
        engine, "sample_requests", "tracking_checked_at",
        "ALTER TABLE sample_requests ADD COLUMN tracking_checked_at TIMESTAMP",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS tracking_checked_at TIMESTAMP",
    )

    if not is_sqlite:
        # quotes.status was created as a native Postgres ENUM type by
        # SQLAlchemy's default (native_enum=True) before this file existed.
        # New QuoteStatus values (Requested/On Hold/Rejected) can't be
        # inserted into that type without an `ALTER TYPE ... ADD VALUE`,
        # which is fragile to run transactionally on older Postgres.
        # Converting the column to plain text sidesteps the enum type
        # entirely — validation already happens at the Pydantic layer,
        # matching the SAEnum(native_enum=False) now used in the model.
        # Safe to re-run: a no-op once the column is already text.
        _run(engine, "ALTER TABLE quotes ALTER COLUMN status TYPE VARCHAR(20) USING status::text")

        # Same fix, same reason — sample_requests.status was also a native
        # Postgres ENUM (native_enum defaulted True) before the in_transit/
        # returned/delivery_issue values were added for Shippo tracking.
        _run(engine, "ALTER TABLE sample_requests ALTER COLUMN status TYPE VARCHAR(20) USING status::text")
