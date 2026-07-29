"""
Copy a single month's SPIFF rules (CommissionSpiffRule) from production/Supabase
into the local SQLite dev database.

Usage:
  SOURCE_DATABASE_URL='postgresql://...' python scripts/sync_supabase_spiff_rules_to_local.py 2026-07

Unlike sync_supabase_samples_to_local.py (which wipes and replaces whole
tables), this only touches the requested month — SPIFF rules are
admin-created/local-test data, not synced reference data, so blowing away
every other month's local rules on every run would be surprising.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.models.db_models import Base, CommissionSpiffRule  # noqa: E402


LOCAL_DATABASE_URL = os.getenv("LOCAL_DATABASE_URL", "sqlite:///./quote_portal.db")


def engine_for(url: str):
    is_sqlite = url.startswith("sqlite")
    return create_engine(
        url,
        connect_args={"check_same_thread": False} if is_sqlite else {},
        poolclass=None if is_sqlite else NullPool,
        use_insertmanyvalues=False,
    )


def main():
    load_dotenv(ROOT / ".env")
    source_url = os.getenv("SOURCE_DATABASE_URL")
    if not source_url:
        raise SystemExit(
            "SOURCE_DATABASE_URL is required. Set it to the Supabase/Postgres DATABASE_URL, "
            "then rerun this script."
        )
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python scripts/sync_supabase_spiff_rules_to_local.py <YYYY-MM>")
    month = sys.argv[1]

    source_engine = engine_for(source_url)
    target_engine = engine_for(LOCAL_DATABASE_URL)
    Base.metadata.create_all(bind=target_engine)

    SourceSession = sessionmaker(bind=source_engine)
    TargetSession = sessionmaker(bind=target_engine)
    source_db = SourceSession()
    target_db = TargetSession()
    try:
        rows = (
            source_db.query(CommissionSpiffRule)
            .filter(CommissionSpiffRule.month == month, CommissionSpiffRule.deleted_at.is_(None))
            .all()
        )
        target_db.query(CommissionSpiffRule).filter(CommissionSpiffRule.month == month).delete()
        target_db.flush()
        for row in rows:
            target_db.add(CommissionSpiffRule(
                id=row.id,
                month=row.month,
                prompt=row.prompt,
                rule_json=row.rule_json,
                created_by=row.created_by,
            ))
        target_db.commit()
    except Exception:
        target_db.rollback()
        raise
    finally:
        source_db.close()
        target_db.close()

    print(f"Copied {len(rows)} SPIFF rule(s) for {month} into local SQLite.")


if __name__ == "__main__":
    main()
