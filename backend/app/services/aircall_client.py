"""
Quote Portal's own Aircall fetch — separate credentials, separate schedule
from sdr-daily-report's copy of this same ~60 lines of HTTP plumbing.
Deliberately NOT shared via sdr_kpi_lib: there's no business-judgment risk
in "GET this URL with these params" the way there is in "is this call
connected," so duplicating the fetch code is a much smaller risk than
duplicating the classification logic would have been.
"""
import os
import time
from datetime import datetime, timedelta, date as date_cls
from zoneinfo import ZoneInfo

import requests

BASE_URL = "https://api.aircall.io/v1/calls"
PST = ZoneInfo("America/Los_Angeles")


def _get_bounds(target_date: date_cls):
    """(from_ts, to_ts) unix timestamps for a full PST calendar day."""
    start = datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0, tzinfo=PST)
    end = start + timedelta(days=1)
    return int(start.timestamp()), int(end.timestamp())


def fetch_calls_for_day(target_date: date_cls):
    """Pull all Aircall calls for the given PST day, following pagination
    until meta.next_page_link is empty. Retries on 429 rate limits."""
    api_id = os.getenv("AIRCALL_API_ID")
    api_token = os.getenv("AIRCALL_API_TOKEN")
    if not api_id or not api_token:
        raise RuntimeError(
            "AIRCALL_API_ID / AIRCALL_API_TOKEN not configured — "
            "these are separate credentials from sdr-daily-report's, "
            "see SDR-PERFORMANCE-INTEGRATION-NOTES.md"
        )

    from_ts, to_ts = _get_bounds(target_date)
    calls = []
    page = 1

    while True:
        resp = requests.get(
            BASE_URL,
            auth=(api_id, api_token),
            params={"from": from_ts, "to": to_ts, "per_page": 50, "page": page, "order": "asc"},
            timeout=30,
        )
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", 5))
            time.sleep(wait)
            continue
        resp.raise_for_status()
        data = resp.json()
        calls.extend(data.get("calls", []))

        next_link = (data.get("meta") or {}).get("next_page_link")
        if not next_link:
            break
        page += 1
        time.sleep(0.3)

    return calls
