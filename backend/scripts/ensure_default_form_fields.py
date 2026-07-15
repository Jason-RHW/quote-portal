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
            "Economy Nitrile (Cost-Effective)",
            "Premium Nitrile (Enhanced Durability)",
            "Industrial Nitrile (Heavy-Duty Use)",
            "Food-Grade Vinyl (Food Handling)",
            "Work Gloves (Enhanced Grip) - Reusable",
            "Cut-Resistant Gloves - Reusable",
        ],
        True,
        True,
        0,
    ),
    ("size", "Size", FormFieldType.dropdown, ["XS", "S", "M", "L", "XL", "XXL"], False, True, 1),
    (
        "color",
        "Color",
        FormFieldType.dropdown,
        ["Black", "Blue", "Burgundy", "Cherry Blossom", "Clear", "Fuchsia", "Green", "Orange", "White", "Yellow"],
        True,
        False,
        2,
    ),
    ("employee_count", "# Employees using gloves", FormFieldType.number, None, False, False, 3),
    ("daily_changes", "Daily glove changes / employee", FormFieldType.number, None, False, False, 4),
    ("current_supplier", "Current brand / supplier", FormFieldType.text, None, False, False, 5),
    ("custom_requirement", "Custom requirement or note", FormFieldType.textarea, None, False, False, 6),
]


def main() -> None:
    inserted = 0
    updated = 0
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
                    """
                    insert into form_fields
                        (id, field_key, label, field_type, options, multiple, required, sort_order, active)
                    values
                        (:id, :field_key, :label, :field_type, CAST(:options AS jsonb),
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
