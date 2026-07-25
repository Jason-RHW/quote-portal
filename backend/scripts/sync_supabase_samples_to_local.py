"""
Copy production/Supabase sample and quote data into the local SQLite dev database.

Usage:
  SOURCE_DATABASE_URL='postgresql://...' python scripts/sync_supabase_samples_to_local.py

This is intentionally a local development helper for SPIFF/mock testing. It
copies the commission-relevant tables needed for realistic local previews.
"""
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.models.db_models import (
    Base,
    Brand,
    FormField,
    Quote,
    SampleRequest,
    SampleRequestBrand,
    Sdr,
    SdrDailyStat,
)


LOCAL_DATABASE_URL = os.getenv("LOCAL_DATABASE_URL", "sqlite:///./quote_portal.db")


MODELS = [Sdr, Brand, FormField, SampleRequest, SampleRequestBrand, Quote, SdrDailyStat]


def stringify(value: Any):
    if value is None:
        return None
    if hasattr(value, "value"):
        return value
    if value.__class__.__module__ == "uuid":
        return str(value)
    return value


def row_data(row) -> dict:
    data = {
        column.key: stringify(getattr(row, column.key))
        for column in inspect(row.__class__).mapper.column_attrs
    }
    if row.__class__ is SampleRequest:
        data["business_name"] = data.get("business_name") or "Unknown business"
        data["custom_fields"] = data.get("custom_fields") or {}
    return data


def engine_for(url: str):
    is_sqlite = url.startswith("sqlite")
    return create_engine(
        url,
        connect_args={"check_same_thread": False} if is_sqlite else {},
        poolclass=None if is_sqlite else NullPool,
        use_insertmanyvalues=False,
    )


def copy_model(source_db, target_db, model):
    rows = source_db.query(model).all()
    target_db.query(model).delete()
    target_db.flush()
    for row in rows:
        target_db.add(model(**row_data(row)))
    target_db.flush()
    return len(rows)


def main():
    load_dotenv(ROOT / ".env")
    source_url = os.getenv("SOURCE_DATABASE_URL")
    if not source_url:
        raise SystemExit(
            "SOURCE_DATABASE_URL is required. Set it to the Supabase/Postgres DATABASE_URL, "
            "then rerun this script."
        )

    source_engine = engine_for(source_url)
    target_engine = engine_for(LOCAL_DATABASE_URL)
    Base.metadata.create_all(bind=target_engine)

    SourceSession = sessionmaker(bind=source_engine)
    TargetSession = sessionmaker(bind=target_engine)
    source_db = SourceSession()
    target_db = TargetSession()
    try:
        counts = {}
        for model in MODELS:
            counts[model.__tablename__] = copy_model(source_db, target_db, model)
        target_db.commit()
    except Exception:
        target_db.rollback()
        raise
    finally:
        source_db.close()
        target_db.close()

    print("Copied production commission data into local SQLite:")
    for table, count in counts.items():
        print(f"- {table}: {count}")


if __name__ == "__main__":
    main()
