"""
Add the form_fields.multiple column expected by the request form/settings UI.

Usage:
    python scripts/ensure_form_fields_multiple.py
"""
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal, is_sqlite


def main():
    db = SessionLocal()
    try:
        if is_sqlite:
            columns = [row[1] for row in db.execute(text("PRAGMA table_info(form_fields)")).all()]
            if "multiple" not in columns:
                db.execute(text("ALTER TABLE form_fields ADD COLUMN multiple boolean NOT NULL DEFAULT 0"))
            db.execute(text("UPDATE form_fields SET multiple = 1 WHERE field_key IN ('glove_type', 'color')"))
        else:
            db.execute(text("ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS multiple boolean NOT NULL DEFAULT false"))
            db.execute(text("UPDATE form_fields SET multiple = true WHERE field_key IN ('glove_type', 'color')"))
        db.commit()
        print("form_fields.multiple is ready.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
