import os
import time
from dataclasses import dataclass
from typing import Optional

import requests

from app.models.db_models import SampleRequest


BASE_URL = "https://api.hubapi.com"
DEFAULT_SAMPLE_SENT_STAGE = "3634488044"


class HubSpotSyncError(Exception):
    pass


@dataclass
class HubSpotSyncResult:
    contact_id: Optional[str] = None
    company_id: Optional[str] = None


def is_configured() -> bool:
    return bool(_access_token())


def _access_token() -> Optional[str]:
    return os.getenv("HUBSPOT_ACCESS_TOKEN") or os.getenv("HUBSPOT_API_KEY")


def _sample_sent_stage() -> str:
    return (
        os.getenv("HUBSPOT_SAMPLE_SENT_STAGE_ID")
        or os.getenv("HUBSPOT_LIFECYCLE_STAGE_SAMPLE_SENT")
        or DEFAULT_SAMPLE_SENT_STAGE
    )


def _headers() -> dict:
    token = _access_token()
    if not token:
        raise HubSpotSyncError("HubSpot token is not configured. Set HUBSPOT_ACCESS_TOKEN or HUBSPOT_API_KEY.")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _request(method: str, path: str, **kwargs) -> dict:
    response = requests.request(method, f"{BASE_URL}{path}", headers=_headers(), timeout=20, **kwargs)
    try:
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise HubSpotSyncError(f"HubSpot {method} {path} failed: {response.status_code} {response.text}") from exc
    if response.content:
        return response.json()
    return {}


def _clean_email(email: Optional[str]) -> str:
    if not email:
        return ""
    return email.encode("ascii", "ignore").decode("ascii").strip()


def find_contact(email: Optional[str], full_name: Optional[str]) -> Optional[str]:
    clean_email = _clean_email(email)
    if clean_email:
        payload = {
            "filterGroups": [{"filters": [{"propertyName": "email", "operator": "EQ", "value": clean_email}]}],
            "properties": ["email", "firstname", "lastname"],
            "limit": 1,
        }
        results = _request("POST", "/crm/v3/objects/contacts/search", json=payload).get("results", [])
        if results:
            return results[0]["id"]

    if full_name:
        name_parts = full_name.strip().split(" ", 1)
        first = name_parts[0] if name_parts else ""
        last = name_parts[1] if len(name_parts) > 1 else ""
        if first:
            payload = {
                "filterGroups": [{"filters": [
                    {"propertyName": "firstname", "operator": "EQ", "value": first},
                    {"propertyName": "lastname", "operator": "EQ", "value": last},
                ]}],
                "properties": ["email", "firstname", "lastname"],
                "limit": 1,
            }
            results = _request("POST", "/crm/v3/objects/contacts/search", json=payload).get("results", [])
            if results:
                return results[0]["id"]

    return None


def find_company(business_name: Optional[str]) -> Optional[str]:
    if not business_name:
        return None
    payload = {
        "filterGroups": [{"filters": [{"propertyName": "name", "operator": "EQ", "value": business_name}]}],
        "properties": ["name"],
        "limit": 1,
    }
    results = _request("POST", "/crm/v3/objects/companies/search", json=payload).get("results", [])
    if results:
        return results[0]["id"]
    return None


def find_company_for_contact(contact_id: str, business_name: Optional[str]) -> Optional[str]:
    try:
        results = _request("GET", f"/crm/v4/objects/contacts/{contact_id}/associations/companies").get("results", [])
        if results:
            return str(results[0]["toObjectId"])
    except HubSpotSyncError:
        pass
    return find_company(business_name)


def create_note_for_contact(contact_id: str, product_sent: str, tracking_id: str) -> bool:
    note_id = _create_note(product_sent, tracking_id)
    _request("PUT", f"/crm/v3/objects/notes/{note_id}/associations/contacts/{contact_id}/note_to_contact")
    return True


def create_note_for_company(company_id: str, product_sent: str, tracking_id: str) -> bool:
    note_id = _create_note(product_sent, tracking_id)
    _request("PUT", f"/crm/v3/objects/notes/{note_id}/associations/companies/{company_id}/note_to_company")
    return True


def _create_note(product_sent: str, tracking_id: str) -> str:
    note_body = f"Product Sent: {product_sent}; USPS Tracking #: {tracking_id}"
    payload = {
        "properties": {
            "hs_note_body": note_body,
            "hs_timestamp": str(int(time.time() * 1000)),
        }
    }
    return _request("POST", "/crm/v3/objects/notes", json=payload)["id"]


def update_contact_tracking_number(contact_id: str, tracking_id: str) -> bool:
    _request(
        "PATCH",
        f"/crm/v3/objects/contacts/{contact_id}",
        json={"properties": {"sample_tracking_number": f"USPS: {tracking_id}"}},
    )
    return True


def update_company_tracking_number(company_id: str, tracking_id: str) -> bool:
    _request(
        "PATCH",
        f"/crm/v3/objects/companies/{company_id}",
        json={"properties": {"sample_tracking_number": f"USPS: {tracking_id}"}},
    )
    return True


def update_contact_lifecycle_stage(contact_id: str) -> bool:
    _request(
        "PATCH",
        f"/crm/v3/objects/contacts/{contact_id}",
        json={"properties": {"lifecyclestage": _sample_sent_stage()}},
    )
    return True


def update_company_lifecycle_stage(company_id: str) -> bool:
    _request(
        "PATCH",
        f"/crm/v3/objects/companies/{company_id}",
        json={"properties": {"lifecyclestage": _sample_sent_stage()}},
    )
    return True


def sync_sample(req: SampleRequest, product_sent: str) -> HubSpotSyncResult:
    tracking_id = (req.tracking_number or "").strip()
    if not tracking_id:
        raise HubSpotSyncError("Tracking number is required before syncing to HubSpot.")

    contact_id = find_contact(req.contact_email, req.contact_name)
    company_id = None

    if contact_id:
        create_note_for_contact(contact_id, product_sent, tracking_id)
        update_contact_lifecycle_stage(contact_id)
        update_contact_tracking_number(contact_id, tracking_id)

        company_id = find_company_for_contact(contact_id, req.business_name)
        if company_id:
            create_note_for_company(company_id, product_sent, tracking_id)
            update_company_lifecycle_stage(company_id)
            update_company_tracking_number(company_id, tracking_id)
        return HubSpotSyncResult(contact_id=contact_id, company_id=company_id)

    company_id = find_company(req.business_name)
    if not company_id:
        raise HubSpotSyncError("No matching HubSpot contact or company was found.")

    create_note_for_company(company_id, product_sent, tracking_id)
    update_company_lifecycle_stage(company_id)
    update_company_tracking_number(company_id, tracking_id)
    return HubSpotSyncResult(company_id=company_id)
