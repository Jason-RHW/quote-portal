"""Ensure the sample request form has the default custom fields.

Usage:
    DATABASE_URL=postgresql://... venv/bin/python scripts/ensure_default_form_fields.py

The script is idempotent: existing fields are updated/reactivated, and missing
fields are inserted.
"""
from __future__ import annotations

import uuid
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402
from app.models.db_models import FormField, FormFieldType  # noqa: E402


DEFAULT_FIELDS = [
    (
        "glove_type",
        "Glove type",
        FormFieldType.dropdown,
        [
            "TitanFlex (Heavy-duty Nitrile)",
            "SwiftLite (Food-handling Vinyl)",
            "SwiftGrip (Colorful Nitrile)",
            "Schneider (Exam-grade Nitrile)",
            "Work Gloves (Enhanced Gripping)",
            "Cut-resistant Gloves (Cut Hazard Protection)",
        ],
        True,
        True,
        0,
    ),
    ("size", "Size", FormFieldType.dropdown, ["XS", "S", "M", "L", "XL", "XXL"], True, True, 1),
    (
        "color",
        "Color",
        FormFieldType.dropdown,
        ["Black", "Blue", "Burgundy", "Cherry Blossom", "Clear", "Fuchsia", "Green", "Orange", "White", "Yellow"],
        True,
        False,
        2,
    ),
    (
        "employee_count",
        "# Employees using gloves",
        FormFieldType.dropdown,
        ["1-10", "10-20", "20-50", "50-100", "100-200", "200+"],
        False,
        False,
        3,
    ),
    (
        "daily_changes",
        "Daily glove changes / employee",
        FormFieldType.dropdown,
        ["1-5", "6-10", "11-20", "20+"],
        False,
        False,
        4,
    ),
    ("current_supplier", "Current brand / supplier", FormFieldType.text, None, False, False, 5),
    ("custom_requirement", "Custom requirement or note", FormFieldType.textarea, None, False, False, 6),
]


def main() -> None:
    inserted = 0
    updated = 0
    # jsonb is a real type on Postgres, but SQLite doesn't recognize it — CAST(x AS jsonb)
    # there falls back to NUMERIC affinity and silently zeroes out the JSON string. Only
    # cast on Postgres; SQLite's JSON column stores the bind_processor'd string as-is.
    options_expr = "CAST(:options AS jsonb)" if engine.dialect.name == "postgresql" else ":options"
    with engine.begin() as conn:
        for field_key, label, field_type, options, multiple, required, sort_order in DEFAULT_FIELDS:
            exists = conn.execute(
                text("select 1 from form_fields where field_key = :field_key"),
                {"field_key": field_key},
            ).first()
            if exists:
                updated += 1
            else:
                inserted += 1

            conn.execute(
                text(
                    f"""
                    insert into form_fields
                        (id, field_key, label, field_type, options, multiple, required, sort_order, active)
                    values
                        (:id, :field_key, :label, :field_type, {options_expr},
                         :multiple, :required, :sort_order, true)
                    on conflict (field_key) do update set
                        label = excluded.label,
                        field_type = excluded.field_type,
                        options = excluded.options,
                        multiple = excluded.multiple,
                        required = excluded.required,
                        sort_order = excluded.sort_order,
                        active = true
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "field_key": field_key,
                    "label": label,
                    "field_type": field_type.value,
                    "options": FormField.options.type.bind_processor(engine.dialect)(options),
                    "multiple": multiple,
                    "required": required,
                    "sort_order": sort_order,
                },
            )

    print(f"Ensured {len(DEFAULT_FIELDS)} form fields: inserted={inserted}, updated={updated}")


if __name__ == "__main__":
    main()
