import base64
import json
import os

from openai import OpenAI

SHIPPING_LABEL_ITEM_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "tracking_number": {"type": ["string", "null"], "description": "The carrier tracking/label number"},
        "carrier": {"type": ["string", "null"], "description": "Shippo carrier token, e.g. \"usps\", \"ups\", \"fedex\", \"dhl_express\""},
        "ship_date": {"type": ["string", "null"], "description": "YYYY-MM-DD, the ship/label creation date printed on the label"},
        "recipient_name": {"type": ["string", "null"], "description": "The individual recipient's name in the ship-to block, if separate from the business name"},
        "business_name": {"type": ["string", "null"], "description": "The recipient business/company name in the ship-to block"},
        "address_line1": {"type": ["string", "null"], "description": "Ship-to street address line 1"},
        "address_line2": {"type": ["string", "null"], "description": "Ship-to street address line 2, if present"},
        "city": {"type": ["string", "null"], "description": "Ship-to city"},
        "state": {"type": ["string", "null"], "description": "Ship-to state, e.g. \"WA\""},
        "zip_code": {"type": ["string", "null"], "description": "Ship-to zip code"},
    },
    "required": [
        "tracking_number", "carrier", "ship_date", "recipient_name", "business_name",
        "address_line1", "address_line2", "city", "state", "zip_code",
    ],
}

# Root must be an object for OpenAI's strict json_schema format — the array
# of labels is nested under "labels" rather than being the bare top-level type.
SHIPPING_LABELS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "labels": {"type": "array", "items": SHIPPING_LABEL_ITEM_SCHEMA},
    },
    "required": ["labels"],
}

EXTRACTION_INSTRUCTIONS = """You are reading a shipping document that may contain ONE OR MORE shipping \
carrier labels (USPS, UPS, FedEx, or similar) — each page is typically a separate label. Extract every \
label you find and return one entry per label, in the order they appear (page order), in the "labels" array.

For each label, extract exactly these fields:
- tracking_number: the tracking/label number printed on the label.
- carrier: which carrier printed this label, normalized to exactly one of these lowercase tokens: \
"usps", "ups", "fedex", "dhl_express". Match based on the carrier's logo/name on the label, not the \
tracking number format. If the carrier isn't one of these four, use the carrier's name lowercased with \
underscores instead of spaces.
- ship_date: the ship date or label creation date printed on the label, as YYYY-MM-DD.
- The "SHIP TO" / recipient block, split into separate fields (don't combine city/state/zip onto one line \
the way they appear on the label — split them into their own fields):
  recipient_name: the individual person's name, if the block shows one separate from the business name.
  business_name: the recipient company/business name.
  address_line1: the street address.
  address_line2: a second address line (suite/unit), only if present — otherwise null.
  city: the city.
  state: the two-letter state code.
  zip_code: the zip code.

Leave any field null if it isn't present on that label. If the document has only one label, return a \
single-item array. Return JSON only."""


class ExtractionError(Exception):
    pass


def extract_shipping_labels(pdf_bytes: bytes, filename: str = "shipping_label.pdf") -> list:
    if not os.getenv("OPENAI_API_KEY"):
        raise ExtractionError("OPENAI_API_KEY is not configured.")

    client = OpenAI()
    model = os.getenv("OPENAI_SHIPPING_LABEL_MODEL", "gpt-5.6-luna")
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
                        {"type": "input_text", "text": "Extract every shipping label from this document."},
                    ],
                }
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "shipping_labels_extraction",
                    "schema": SHIPPING_LABELS_SCHEMA,
                    "strict": True,
                },
                "verbosity": "low",
            },
            reasoning={"effort": "low"},
            max_output_tokens=4000,
        )
    except Exception as e:
        raise ExtractionError(f"Couldn't read that PDF: {e}") from e

    try:
        return json.loads(response.output_text)["labels"]
    except (json.JSONDecodeError, AttributeError, KeyError) as e:
        raise ExtractionError(f"Couldn't parse the extracted data: {e}") from e
