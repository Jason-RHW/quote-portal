"""
One-time cleanup for historical sample imports.

Use after setting DATABASE_URL to Supabase:

    python scripts/sync_sample_created_at_to_requested_date.py --dry-run
    python scripts/sync_sample_created_at_to_requested_date.py

It aligns requested_date to created_at for rows imported from the historical
setup. By default it updates all existing sample_requests; future request-form
submissions are not affected.
"""
import argparse
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal, is_sqlite


POSTGRES_PREVIEW_SQL = "SELECT COUNT(*) FROM sample_requests"

POSTGRES_UPDATE_SQL = """
UPDATE sample_requests
SET
    requested_date = created_at::date
WHERE created_at IS NOT NULL
"""

POSTGRES_EXCEL_PREVIEW_SQL = """
SELECT COUNT(*)
FROM sample_requests sr
WHERE EXISTS (
    SELECT 1
    FROM sample_request_events sre
    WHERE sre.sample_request_id = sr.id
      AND sre.changed_by = 'Excel backfill'
)
"""

POSTGRES_EXCEL_UPDATE_SQL = """
UPDATE sample_requests
SET
    requested_date = created_at::date
WHERE EXISTS (
    SELECT 1
    FROM sample_request_events sre
    WHERE sre.sample_request_id = sample_requests.id
      AND sre.changed_by = 'Excel backfill'
)
AND created_at IS NOT NULL
"""

SQLITE_PREVIEW_SQL = "SELECT COUNT(*) FROM sample_requests"

SQLITE_UPDATE_SQL = """
UPDATE sample_requests
SET
    requested_date = date(created_at)
WHERE created_at IS NOT NULL
"""

SQLITE_EXCEL_PREVIEW_SQL = """
SELECT COUNT(*)
FROM sample_requests
WHERE EXISTS (
    SELECT 1
    FROM sample_request_events sre
    WHERE sre.sample_request_id = sample_requests.id
      AND sre.changed_by = 'Excel backfill'
)
"""

SQLITE_EXCEL_UPDATE_SQL = """
UPDATE sample_requests
SET
    requested_date = date(created_at)
WHERE id IN (
    SELECT sample_request_id
    FROM sample_request_events
    WHERE changed_by = 'Excel backfill'
)
AND created_at IS NOT NULL
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Preview row count without updating.")
    parser.add_argument("--only-excel-backfill", action="store_true", help="Only update rows with an Excel backfill event.")
    args = parser.parse_args()

    if args.only_excel_backfill:
        preview_sql = SQLITE_EXCEL_PREVIEW_SQL if is_sqlite else POSTGRES_EXCEL_PREVIEW_SQL
        update_sql = SQLITE_EXCEL_UPDATE_SQL if is_sqlite else POSTGRES_EXCEL_UPDATE_SQL
    else:
        preview_sql = SQLITE_PREVIEW_SQL if is_sqlite else POSTGRES_PREVIEW_SQL
        update_sql = SQLITE_UPDATE_SQL if is_sqlite else POSTGRES_UPDATE_SQL

    db = SessionLocal()
    try:
        count = db.execute(text(preview_sql)).scalar() or 0
        if args.dry_run:
            print(f"DRY RUN: would sync requested_date from created_at for {count} historical sample records.")
            return

        result = db.execute(text(update_sql))
        db.commit()
        print(f"Synced requested_date from created_at for {result.rowcount if result.rowcount is not None else count} historical sample records.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
