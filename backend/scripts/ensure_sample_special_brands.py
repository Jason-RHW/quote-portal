"""Ensure special sample brands exist and backfill note-based assignments.

Usage:
    DATABASE_URL=postgresql://... venv/bin/python scripts/ensure_sample_special_brands.py

The script is idempotent. It creates/reactivates the brands if needed, then
adds sample_request_brands rows when assignment_note mentions the product.
"""
from __future__ import annotations

import re
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402


SPECIAL_BRANDS = [
    {
        "name": "Cut Resistant Gloves",
        "color_bg": "#ECFEFF",
        "color_text": "#0E7490",
        "patterns": [r"\bcut[-\s]?resistant\b", r"\bcut[-\s]?resistant gloves?\b"],
    },
    {
        "name": "Work Gloves",
        "color_bg": "#F5F3FF",
        "color_text": "#6D28D9",
        "patterns": [r"\bwork gloves?\b"],
    },
    {
        "name": "Bandage",
        "color_bg": "#FEF2F2",
        "color_text": "#B91C1C",
        "patterns": [r"\bbandages?\b"],
    },
]


def gen_id() -> str:
    return str(uuid.uuid4())


def note_matches(note: str, patterns: list[str]) -> bool:
    return any(re.search(pattern, note, flags=re.IGNORECASE) for pattern in patterns)


def main() -> None:
    created_or_updated = 0
    assignments_added = 0
    with engine.begin() as conn:
        brand_specs = []
        for spec in SPECIAL_BRANDS:
            brand_id = conn.execute(
                text("select id from brands where name = :name"),
                {"name": spec["name"]},
            ).scalar_one_or_none()
            if not brand_id:
                brand_id = gen_id()
                conn.execute(
                    text(
                        """
                        insert into brands (id, name, color_bg, color_text, active)
                        values (CAST(:id AS uuid), :name, :color_bg, :color_text, true)
                        """
                    ),
                    {
                        "id": brand_id,
                        "name": spec["name"],
                        "color_bg": spec["color_bg"],
                        "color_text": spec["color_text"],
                    },
                )
            else:
                conn.execute(
                    text(
                        """
                        update brands
                        set color_bg = :color_bg, color_text = :color_text, active = true
                        where id = :id
                        """
                    ),
                    {
                        "id": brand_id,
                        "color_bg": spec["color_bg"],
                        "color_text": spec["color_text"],
                    },
                )
            brand_specs.append((str(brand_id), spec))
            created_or_updated += 1

        requests = conn.execute(
            text("select id, assignment_note from sample_requests where assignment_note is not null")
        ).fetchall()
        for req_id, assignment_note in requests:
            note = assignment_note or ""
            for brand_id, spec in brand_specs:
                if not note_matches(note, spec["patterns"]):
                    continue
                inserted = conn.execute(
                    text(
                        """
                        insert into sample_request_brands (id, sample_request_id, brand_id)
                        values (CAST(:id AS uuid), :sample_request_id, CAST(:brand_id AS uuid))
                        on conflict (sample_request_id, brand_id) do nothing
                        """
                    ),
                    {"id": gen_id(), "sample_request_id": req_id, "brand_id": brand_id},
                )
                assignments_added += inserted.rowcount or 0

    print(f"Ensured {created_or_updated} brands and added {assignments_added} note-based assignments.")


if __name__ == "__main__":
    main()
