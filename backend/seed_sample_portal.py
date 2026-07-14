"""
Seeds sdrs, brands, and form_fields for the Sample Management Portal.
Run once against a fresh DB (local SQLite for dev, or Supabase for prod):

    python seed_sample_portal.py

Safe to re-run — skips rows that already exist by unique key (full_name /
name / field_key) rather than erroring or duplicating.

Note on the SDR roster: this replaces frontend/src/config/sdrs.js as the
source of truth (that file was a hardcoded array that had already drifted
out of date — see the schema-design conversation). Once the frontend reads
from GET /api/sdrs instead, sdrs.js can be deleted. Review this list against
the actual current roster before running against production — it reflects
what's in Claude's shared-context notes as of this build, not a live HR
source.
"""
import sys
import uuid

sys.path.insert(0, ".")
from app.database import SessionLocal, engine, Base
from app.models.db_models import Sdr, Brand, FormField, FormFieldType

SDRS = [
    # (full_name, active)
    ("Maria Gladys Palmares", True),
    ("Basilio Asuncion", True),
    ("Harhel Grace Manansala", True),
    ("Henry Park", True),
    ("Lhoreto Bamiano", False),   # departed
    ("Stephanie Ong", False),    # departed
]

BRANDS = [
    # (name, color_bg, color_text)
    ("Schneider", "#EFF6FF", "#1D4ED8"),
    ("SwiftGrip", "#FDF2F8", "#BE185D"),
    ("SwiftLite", "#F0FDF4", "#15803D"),
    ("TitanFlex", "#FFF7ED", "#C2410C"),
]

FORM_FIELDS = [
    # (field_key, label, field_type, options, multiple, required, sort_order)
    ("glove_type", "Glove type", FormFieldType.dropdown, [
        "Economy Nitrile (Cost-Effective)", "Premium Nitrile (Enhanced Durability)",
        "Industrial Nitrile (Heavy-Duty Use)", "Food-Grade Vinyl (Food Handling)",
        "Work Gloves (Enhanced Grip) - Reusable", "Cut-Resistant Gloves - Reusable",
    ], True, True, 0),
    ("size", "Size", FormFieldType.dropdown, ["XS", "S", "M", "L", "XL", "XXL"], False, True, 1),
    ("color", "Color", FormFieldType.dropdown, [
        "Black", "Blue", "Burgundy", "Cherry Blossom", "Clear",
        "Fuchsia", "Green", "Orange", "White", "Yellow",
    ], True, False, 2),
    ("employee_count", "# Employees using gloves", FormFieldType.number, None, False, False, 3),
    ("daily_changes", "Daily glove changes / employee", FormFieldType.number, None, False, False, 4),
    ("current_supplier", "Current brand / supplier", FormFieldType.text, None, False, False, 5),
    ("custom_requirement", "Custom requirement or note", FormFieldType.textarea, None, False, False, 6),
]


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    for full_name, active in SDRS:
        if db.query(Sdr).filter(Sdr.full_name == full_name).first():
            continue
        db.add(Sdr(id=str(uuid.uuid4()), full_name=full_name, active=active))
    db.commit()
    print(f"Seeded {len(SDRS)} SDRs (skipping any that already existed).")

    for name, bg, text in BRANDS:
        if db.query(Brand).filter(Brand.name == name).first():
            continue
        db.add(Brand(id=str(uuid.uuid4()), name=name, color_bg=bg, color_text=text, active=True))
    db.commit()
    print(f"Seeded {len(BRANDS)} brands (skipping any that already existed).")

    for field_key, label, field_type, options, multiple, required, sort_order in FORM_FIELDS:
        if db.query(FormField).filter(FormField.field_key == field_key).first():
            continue
        db.add(FormField(
            id=str(uuid.uuid4()), field_key=field_key, label=label, field_type=field_type,
            options=options, multiple=multiple, required=required, sort_order=sort_order, active=True,
        ))
    db.commit()
    print(f"Seeded {len(FORM_FIELDS)} form fields (skipping any that already existed).")

    db.close()


if __name__ == "__main__":
    main()
