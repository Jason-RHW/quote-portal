import base64
import json
import os

from openai import OpenAI

PO_EXTRACTION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "po_number": {"type": ["string", "null"]},
        "date_of_po": {"type": ["string", "null"], "description": "YYYY-MM-DD, the date printed on the document"},
        "business_name": {"type": ["string", "null"], "description": "The customer/buyer placing the order"},
        "ship_to_business_name": {"type": ["string", "null"], "description": "Ship-to business/recipient name"},
        "ship_to_address_line1": {"type": ["string", "null"], "description": "Ship-to street address line 1"},
        "ship_to_address_line2": {"type": ["string", "null"], "description": "Ship-to street address line 2, if present"},
        "ship_to_city": {"type": ["string", "null"], "description": "Ship-to city"},
        "ship_to_state_zip": {"type": ["string", "null"], "description": "Ship-to state and zip, e.g. \"WA 98682\""},
        "line_items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "brand": {"type": "string"},
                    "sku": {"type": ["string", "null"]},
                    "quantity": {"type": ["number", "null"]},
                    "unit": {"type": ["string", "null"], "enum": ["Case", "Box", None]},
                    "unit_price": {"type": ["number", "null"]},
                },
                "required": ["brand", "sku", "quantity", "unit", "unit_price"],
            },
        },
    },
    "required": [
        "po_number", "date_of_po", "business_name",
        "ship_to_business_name", "ship_to_address_line1", "ship_to_address_line2",
        "ship_to_city", "ship_to_state_zip", "line_items",
    ],
}

EXTRACTION_INSTRUCTIONS = """You are reading a customer's purchase order (PO) document for a distributor. \
Extract exactly these fields:
- po_number: the PO number/reference printed on the document.
- date_of_po: the date printed on the document (the order/issue date, not a due/ship date), as YYYY-MM-DD.
- business_name: the customer/buyer's company name (who is placing the order — usually the "Bill To" or \
letterhead company, not the distributor/seller receiving the order).
- Shipping/delivery address, if present, split into separate fields (don't combine city/state/zip onto one \
line with a comma the way they might appear on the document — split them into their own fields):
  ship_to_business_name: the recipient business name on the shipping address.
  ship_to_address_line1: the street address.
  ship_to_address_line2: a second address line (suite/unit), only if the document has one — otherwise null.
  ship_to_city: the city.
  ship_to_state_zip: the state and zip together, e.g. "WA 98682".
- line_items: one entry per ordered product line, with brand, sku (if present), quantity, unit (normalize \
to exactly "Case" or "Box" — infer "Case" if the document doesn't specify a unit), and unit_price (the \
per-unit price, not the line total).

For brand, we only sell four product lines: TitanFlex, SwiftGrip, Schneider, SwiftLite. If a line item's \
product name clearly matches one of these (e.g. "TitanFlex Nitrile Gloves", "TitanFlex-brand exam gloves") \
set brand to exactly that one word ("TitanFlex"), not the full product description. If it doesn't match any \
of the four, set brand to the product name as printed on the document.

Leave any field null if it isn't present in the document. Return JSON only."""


class ExtractionError(Exception):
    pass


def extract_po_from_pdf(pdf_bytes: bytes, filename: str = "purchase_order.pdf") -> dict:
    if not os.getenv("OPENAI_API_KEY"):
        raise ExtractionError("OPENAI_API_KEY is not configured.")

    client = OpenAI()
    model = os.getenv("OPENAI_PO_EXTRACTION_MODEL", "gpt-5.6-luna")
    file_data = f"data:application/pdf;base64,{base64.b64encode(pdf_bytes).decode('ascii')}"

    try:
        response = client.responses.create(
            model=model,
            instructions=EXTRACTION_INSTRUCTIONS,
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_file", "filename": filename, "file_data": file_data},
                        {"type": "input_text", "text": "Extract the purchase order details from this document."},
                    ],
                }
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "po_extraction",
                    "schema": PO_EXTRACTION_SCHEMA,
                    "strict": True,
                },
                "verbosity": "low",
            },
            reasoning={"effort": "low"},
            max_output_tokens=2000,
        )
    except Exception as e:
        raise ExtractionError(f"Couldn't read that PDF: {e}") from e

    try:
        return json.loads(response.output_text)
    except (json.JSONDecodeError, AttributeError) as e:
        raise ExtractionError(f"Couldn't parse the extracted data: {e}") from e
