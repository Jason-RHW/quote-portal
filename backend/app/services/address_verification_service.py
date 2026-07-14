"""
AI address verification — OpenAI Responses API + hosted web_search tool
ONLY. No separate geocoding/places API (Google Places was in the original
design but explicitly dropped per direction — web_search covers the same
"does this business exist at this address" lookup without a second vendor).

Design (from the schema/prompt-design conversation):
- The model returns match_type + confidence + reasoning + source_url as
  JSON, NOT a final ai_verified/unverified decision — that mapping is
  applied deterministically here in code (see _decide_status), not trusted
  from the model's own judgment. This keeps the threshold tunable in one
  place instead of buried in a prompt.
- Runs synchronously on submit/create, wrapped in try/except — a failed or
  unconfigured AI call must never block someone from actually submitting a
  sample request. No OPENAI_API_KEY set → silently stays "unverified".
"""
import json
import os
from typing import Optional

from app.models.db_models import SampleRequest, AddressVerificationStatus

CONFIDENCE_THRESHOLD = 75  # tune after watching real results — see design conversation

SYSTEM_INSTRUCTIONS = """You are an address verification assistant for Schneider Direct, a B2B PPE distributor. You will be given a business name and a mailing address that a sales rep entered when requesting a product sample be shipped there. Use web search to determine whether this business genuinely operates at this address today.

Search for the business name combined with the city/state, and separately check whether the address resolves to a real commercial location tied to that business (Google Business listings, the company's own website, state business registries, BBB, Yelp, etc).

Respond with ONLY a single JSON object matching this schema — no text before or after it:

{
  "match_type": "exact_match" | "name_match_different_address" | "address_match_different_name" | "no_listing_found" | "business_closed",
  "confidence": <integer 0-100>,
  "reasoning": "<one or two sentences, written for a non-technical admin>",
  "source_url": "<the single most relevant URL you found, or null>"
}

Guidelines:
- "exact_match": the business name (allowing minor differences like "LLC"/"Inc") appears at this exact address in a credible source.
- "name_match_different_address": you found this business, but its listed address doesn't match what was submitted.
- "address_match_different_name": a business exists at this address, under a different name.
- "no_listing_found": no credible source connects this business to any address.
- "business_closed": sources indicate it has permanently closed.
- confidence reflects source quality/agreement, not just whether a match type was found."""


def _decide_status(match_type: str, confidence: int) -> AddressVerificationStatus:
    if match_type == "exact_match" and confidence >= CONFIDENCE_THRESHOLD:
        return AddressVerificationStatus.ai_verified
    return AddressVerificationStatus.unverified


def _build_input(req: SampleRequest) -> str:
    address = ", ".join(filter(None, [req.address_line, req.city, req.state, req.zip_code])) or "not provided"
    return (
        f"Business name: {req.business_name}\n"
        f"Address: {address}\n"
    )


def is_configured() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def verify_address(req: SampleRequest) -> Optional[dict]:
    """Returns a dict with status/note/confidence/source_url, or None if
    verification couldn't run (not configured, or the call failed) —
    callers should leave the record's existing verification state
    untouched in that case, not treat None as a negative result."""
    if not is_configured():
        return None

    try:
        from openai import OpenAI
        client = OpenAI()

        response = client.responses.create(
            model=os.getenv("OPENAI_VERIFICATION_MODEL", "gpt-5-mini"),
            instructions=SYSTEM_INSTRUCTIONS,
            input=_build_input(req),
            tools=[{"type": "web_search"}],
        )

        raw_text = (response.output_text or "").strip()
        # Models occasionally wrap JSON in ```json fences despite instructions — strip defensively.
        if raw_text.startswith("```"):
            raw_text = raw_text.strip("`")
            if raw_text.lower().startswith("json"):
                raw_text = raw_text[4:].strip()

        parsed = json.loads(raw_text)
        match_type = parsed.get("match_type", "no_listing_found")
        confidence = int(parsed.get("confidence", 0))
        reasoning = parsed.get("reasoning", "No reasoning provided.")
        source_url = parsed.get("source_url")

        status = _decide_status(match_type, confidence)

        return {
            "status": status,
            "note": reasoning,
            "confidence": confidence,
            "source_url": source_url,
        }
    except Exception as e:
        # Never let a verification failure block sample-request creation or
        # a manual re-check — log-and-skip. (print() is a placeholder for
        # real logging; swap for your logger of choice.)
        print(f"[address_verification] failed: {e}")
        return None
