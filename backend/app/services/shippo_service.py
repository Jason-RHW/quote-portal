"""
Shippo tracking lookup — read-only, once-daily polling from cron.py's
/sync-tracking job (see sample_service.sync_tracking_statuses). Deliberately
NOT webhook-based: Shippo's webhook flow requires a live API key per their
docs, so it can't be exercised with a test key locally. A direct per-record
GET lookup works the same in test and live mode and needs no public URL.

Mirrors hubspot_service.py's shape (requests-based, is_configured() guard,
custom exception) for consistency with the other external-API service here.
"""
import os
from typing import Optional

import requests

BASE_URL = "https://api.goshippo.com"


class ShippoTrackingError(Exception):
    pass


def is_configured() -> bool:
    return bool(os.getenv("SHIPPO_API_KEY"))


def get_tracking_status(carrier: str, tracking_number: str) -> dict:
    api_key = os.getenv("SHIPPO_API_KEY")
    if not api_key:
        raise ShippoTrackingError("SHIPPO_API_KEY is not configured.")

    try:
        resp = requests.get(
            f"{BASE_URL}/tracks/{carrier}/{tracking_number}",
            headers={"Authorization": f"ShippoToken {api_key}"},
            timeout=15,
        )
    except requests.RequestException as e:
        raise ShippoTrackingError(f"Couldn't reach Shippo: {e}") from e

    if resp.status_code != 200:
        raise ShippoTrackingError(f"Shippo returned {resp.status_code}: {resp.text[:300]}")

    return resp.json()


def parse_status(data: dict) -> tuple:
    """Returns (status, status_details, status_date) from a get_tracking_status() response."""
    tracking_status: Optional[dict] = data.get("tracking_status") or {}
    return (
        tracking_status.get("status"),
        tracking_status.get("status_details"),
        tracking_status.get("status_date"),
    )
