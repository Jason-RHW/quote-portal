import os
import time
from dataclasses import dataclass
from datetime import date
from typing import Optional

import requests

from app.models.db_models import SampleRequest, SampleRequestStatus


BASE_URL = "https://api.hubapi.com"
DEFAULT_SAMPLE_SENT_STAGE = "3634488044"
DEFAULT_SAMPLE_DELIVERED_STAGE = "3631125214"

# HubSpot's built-in ("HUBSPOT_DEFINED") association type IDs between a
# contact and a company — these are fixed platform constants, not portal
# specific, so no env var is needed for them. 1 = "Primary"; the plain
# unlabeled "Company" association most portals additionally offer is 279,
# which we deliberately don't use here since a-d requires primary company.
CONTACT_TO_COMPANY_PRIMARY_ASSOCIATION_TYPE_ID = 1


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


def _sample_delivered_stage() -> str:
    return (
        os.getenv("HUBSPOT_SAMPLE_DELIVERED_STAGE_ID")
        or os.getenv("HUBSPOT_LIFECYCLE_STAGE_SAMPLE_DELIVERED")
        or DEFAULT_SAMPLE_DELIVERED_STAGE
    )


def _sample_requested_stage() -> str:
    stage = os.getenv("HUBSPOT_SAMPLE_REQUESTED_STAGE_ID")
    if not stage:
        raise HubSpotSyncError(
            "HUBSPOT_SAMPLE_REQUESTED_STAGE_ID is not configured. Set it to the "
            "lifecycle stage ID HubSpot uses for 'Sample Requested'."
        )
    return stage


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


def _split_name(full_name: str) -> tuple:
    name_parts = full_name.strip().split(" ", 1)
    first = name_parts[0] if name_parts else ""
    last = name_parts[1] if len(name_parts) > 1 else ""
    return first, last


def _clean_phone(phone: Optional[str]) -> str:
    if not phone:
        return ""
    return "".join(ch for ch in phone if ch.isdigit() or ch == "+")


def find_contact_by_email(email: Optional[str]) -> Optional[str]:
    clean_email = _clean_email(email)
    if not clean_email:
        return None
    payload = {
        "filterGroups": [{"filters": [{"propertyName": "email", "operator": "EQ", "value": clean_email}]}],
        "properties": ["email", "firstname", "lastname"],
        "limit": 1,
    }
    results = _request("POST", "/crm/v3/objects/contacts/search", json=payload).get("results", [])
    return results[0]["id"] if results else None


def find_contact_by_phone_and_name(phone: Optional[str], full_name: Optional[str]) -> Optional[str]:
    """Requires phone AND name to both match the same contact — phone alone
    is too easy to collide on (shared/placeholder numbers in older CRM data),
    so this is deliberately stricter than a phone-only lookup."""
    clean_phone = _clean_phone(phone)
    if not clean_phone or not full_name:
        return None
    first, last = _split_name(full_name)
    if not first:
        return None
    payload = {
        "filterGroups": [
            {"filters": [
                {"propertyName": "phone", "operator": "EQ", "value": clean_phone},
                {"propertyName": "firstname", "operator": "EQ", "value": first},
                {"propertyName": "lastname", "operator": "EQ", "value": last},
            ]},
            {"filters": [
                {"propertyName": "mobilephone", "operator": "EQ", "value": clean_phone},
                {"propertyName": "firstname", "operator": "EQ", "value": first},
                {"propertyName": "lastname", "operator": "EQ", "value": last},
            ]},
        ],
        "properties": ["email", "phone", "mobilephone", "firstname", "lastname"],
        "limit": 1,
    }
    results = _request("POST", "/crm/v3/objects/contacts/search", json=payload).get("results", [])
    return results[0]["id"] if results else None


def find_contact_by_name(full_name: Optional[str]) -> Optional[str]:
    if not full_name:
        return None
    first, last = _split_name(full_name)
    if not first:
        return None
    payload = {
        "filterGroups": [{"filters": [
            {"propertyName": "firstname", "operator": "EQ", "value": first},
            {"propertyName": "lastname", "operator": "EQ", "value": last},
        ]}],
        "properties": ["email", "firstname", "lastname"],
        "limit": 1,
    }
    results = _request("POST", "/crm/v3/objects/contacts/search", json=payload).get("results", [])
    return results[0]["id"] if results else None


def find_contact(email: Optional[str], full_name: Optional[str]) -> Optional[str]:
    return find_contact_by_email(email) or find_contact_by_name(full_name)


def create_contact(email: Optional[str], phone: Optional[str], full_name: Optional[str]) -> str:
    properties = {}
    clean_email = _clean_email(email)
    if clean_email:
        properties["email"] = clean_email
    if phone:
        properties["phone"] = phone
    if full_name:
        first, last = _split_name(full_name)
        if first:
            properties["firstname"] = first
        if last:
            properties["lastname"] = last
    return _request("POST", "/crm/v3/objects/contacts", json={"properties": properties})["id"]


def find_or_create_contact(email: Optional[str], phone: Optional[str], full_name: Optional[str]) -> str:
    """a) Match by email, then by phone+name together; create a new contact
    (with phone + email set) if neither matches."""
    contact_id = (
        find_contact_by_email(email)
        or find_contact_by_phone_and_name(phone, full_name)
    )
    if contact_id:
        return contact_id
    return create_contact(email, phone, full_name)


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


def find_company_by_name_and_state(business_name: Optional[str], state: Optional[str]) -> Optional[str]:
    if not business_name:
        return None
    filters = [{"propertyName": "name", "operator": "EQ", "value": business_name}]
    if state:
        filters.append({"propertyName": "state", "operator": "EQ", "value": state})
    payload = {
        "filterGroups": [{"filters": filters}],
        "properties": ["name", "state"],
        "limit": 1,
    }
    results = _request("POST", "/crm/v3/objects/companies/search", json=payload).get("results", [])
    return results[0]["id"] if results else None


def create_company(
    business_name: str,
    state: Optional[str],
    address_line: Optional[str],
    city: Optional[str],
    zip_code: Optional[str],
) -> str:
    properties = {"name": business_name}
    if state:
        properties["state"] = state
    if address_line:
        properties["address"] = address_line
    if city:
        properties["city"] = city
    if zip_code:
        properties["zip"] = zip_code
    return _request("POST", "/crm/v3/objects/companies", json={"properties": properties})["id"]


def find_or_create_company(
    business_name: str,
    state: Optional[str],
    address_line: Optional[str],
    city: Optional[str],
    zip_code: Optional[str],
) -> str:
    """b) Match by business name + state; create a new company (with the
    address written in) if none matches."""
    company_id = find_company_by_name_and_state(business_name, state)
    if company_id:
        return company_id
    return create_company(business_name, state, address_line, city, zip_code)


def get_owner_id(object_type: str, object_id: str) -> Optional[str]:
    result = _request(
        "GET",
        f"/crm/v3/objects/{object_type}/{object_id}",
        params={"properties": "hubspot_owner_id"},
    )
    return result.get("properties", {}).get("hubspot_owner_id")


def update_contact_owner(contact_id: str, owner_id: str) -> bool:
    _request(
        "PATCH",
        f"/crm/v3/objects/contacts/{contact_id}",
        json={"properties": {"hubspot_owner_id": owner_id}},
    )
    return True


def update_company_owner(company_id: str, owner_id: str) -> bool:
    _request(
        "PATCH",
        f"/crm/v3/objects/companies/{company_id}",
        json={"properties": {"hubspot_owner_id": owner_id}},
    )
    return True


def set_primary_company_association(contact_id: str, company_id: str) -> bool:
    """c) Associate the company to the contact as its primary company,
    regardless of whether either side was just matched or just created."""
    _request(
        "PUT",
        f"/crm/v4/objects/contacts/{contact_id}/associations/companies/{company_id}",
        json=[{
            "associationCategory": "HUBSPOT_DEFINED",
            "associationTypeId": CONTACT_TO_COMPANY_PRIMARY_ASSOCIATION_TYPE_ID,
        }],
    )
    return True


def find_company_for_contact(contact_id: str, business_name: Optional[str]) -> Optional[str]:
    try:
        results = _request("GET", f"/crm/v4/objects/contacts/{contact_id}/associations/companies").get("results", [])
        if results:
            return str(results[0]["toObjectId"])
    except HubSpotSyncError:
        pass
    return find_company(business_name)


def find_primary_company_for_contact(contact_id: str, business_name: Optional[str]) -> Optional[str]:
    try:
        results = _request("GET", f"/crm/v4/objects/contacts/{contact_id}/associations/companies").get("results", [])
        company_ids = []
        for association in results:
            company_id = association.get("toObjectId") or association.get("id")
            if not company_id:
                continue
            company_ids.append(str(company_id))
            labels = [
                str(assoc_type.get("label", "")).strip().lower()
                for assoc_type in association.get("associationTypes", [])
            ]
            if "primary" in labels:
                return str(company_id)
        if len(company_ids) == 1:
            return company_ids[0]
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


def create_delivery_note_for_contact(contact_id: str, delivered_date: date) -> bool:
    note_id = _create_delivery_note(delivered_date)
    _request("PUT", f"/crm/v3/objects/notes/{note_id}/associations/contacts/{contact_id}/note_to_contact")
    return True


def create_delivery_note_for_company(company_id: str, delivered_date: date) -> bool:
    note_id = _create_delivery_note(delivered_date)
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


def _create_delivery_note(delivered_date: date) -> str:
    note_body = f"Sample was delivered on {delivered_date.isoformat()}."
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


def update_contact_requested_lifecycle_stage(contact_id: str) -> bool:
    _request(
        "PATCH",
        f"/crm/v3/objects/contacts/{contact_id}",
        json={"properties": {"lifecyclestage": _sample_requested_stage()}},
    )
    return True


def update_company_requested_lifecycle_stage(company_id: str) -> bool:
    _request(
        "PATCH",
        f"/crm/v3/objects/companies/{company_id}",
        json={"properties": {"lifecyclestage": _sample_requested_stage()}},
    )
    return True


def update_contact_delivered_lifecycle_stage(contact_id: str) -> bool:
    _request(
        "PATCH",
        f"/crm/v3/objects/contacts/{contact_id}",
        json={"properties": {"lifecyclestage": _sample_delivered_stage()}},
    )
    return True


def update_company_delivered_lifecycle_stage(company_id: str) -> bool:
    _request(
        "PATCH",
        f"/crm/v3/objects/companies/{company_id}",
        json={"properties": {"lifecyclestage": _sample_delivered_stage()}},
    )
    return True


def find_contact_list_by_name(list_name: str) -> Optional[str]:
    response = _request(
        "GET",
        "/crm/v3/lists",
        params={"objectTypeId": "0-1", "listType": "STATIC", "count": 500},
    )
    for list_item in response.get("lists", []):
        if list_item.get("name") == list_name:
            return str(list_item.get("listId") or list_item.get("id"))
    return None


def create_static_contact_list(list_name: str) -> Optional[str]:
    response = _request(
        "POST",
        "/crm/v3/lists",
        json={"name": list_name, "objectTypeId": "0-1", "processingType": "MANUAL"},
    )
    list_data = response.get("list", response)
    list_id = list_data.get("listId") or list_data.get("id")
    return str(list_id) if list_id else None


def get_or_create_static_contact_list(list_name: str) -> Optional[str]:
    return find_contact_list_by_name(list_name) or create_static_contact_list(list_name)


def add_contact_to_list(list_id: str, contact_id: str) -> bool:
    _request("PUT", f"/crm/v3/lists/{list_id}/memberships/add", json=[int(contact_id)])
    return True


def add_contact_to_delivered_list(contact_id: str, delivered_date: date) -> bool:
    list_name = f"Sample Delivered Contacts {date.today().isoformat()}"
    list_id = get_or_create_static_contact_list(list_name)
    if not list_id:
        raise HubSpotSyncError(f"Could not create or find HubSpot list: {list_name}")
    return add_contact_to_list(list_id, contact_id)


def sync_sample_requested(req: SampleRequest, sdr_owner_id: Optional[str] = None) -> HubSpotSyncResult:
    """Runs right after a sample request is submitted: match-or-create the
    contact and company, associate the company as primary, push both to
    the 'Sample Requested' lifecycle stage, and (if the submitting SDR has
    a HubSpot owner ID configured) reassign both records' owner to that
    SDR — even if they already belonged to someone else in HubSpot, so
    ownership always reflects who's actively working the account. Skips
    the write if the current owner already matches, to avoid a no-op PATCH.
    Steps a-d from the SDR form's HubSpot integration spec."""
    contact_id = find_or_create_contact(req.contact_email, req.contact_phone, req.contact_name)
    company_id = find_or_create_company(req.business_name, req.state, req.address_line, req.city, req.zip_code)
    set_primary_company_association(contact_id, company_id)
    update_contact_requested_lifecycle_stage(contact_id)
    update_company_requested_lifecycle_stage(company_id)
    if sdr_owner_id:
        if get_owner_id("contacts", contact_id) != sdr_owner_id:
            update_contact_owner(contact_id, sdr_owner_id)
        if get_owner_id("companies", company_id) != sdr_owner_id:
            update_company_owner(company_id, sdr_owner_id)
    return HubSpotSyncResult(contact_id=contact_id, company_id=company_id)


def sync_sample(req: SampleRequest, product_sent: str) -> HubSpotSyncResult:
    if req.status == SampleRequestStatus.delivered:
        return sync_sample_delivered(req)
    return sync_sample_sent(req, product_sent)


def sync_sample_sent(req: SampleRequest, product_sent: str) -> HubSpotSyncResult:
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


def sync_sample_delivered(req: SampleRequest) -> HubSpotSyncResult:
    if not req.delivered_date:
        raise HubSpotSyncError("Delivered date is required before syncing delivery to HubSpot.")

    contact_id = find_contact(req.contact_email, req.contact_name)
    if not contact_id:
        raise HubSpotSyncError("No matching HubSpot contact was found for delivery sync.")

    company_id = find_primary_company_for_contact(contact_id, req.business_name)
    if not company_id:
        raise HubSpotSyncError("No matching HubSpot company was found for delivery sync.")

    create_delivery_note_for_contact(contact_id, req.delivered_date)
    update_contact_delivered_lifecycle_stage(contact_id)
    create_delivery_note_for_company(company_id, req.delivered_date)
    update_company_delivered_lifecycle_stage(company_id)
    add_contact_to_delivered_list(contact_id, req.delivered_date)
    return HubSpotSyncResult(contact_id=contact_id, company_id=company_id)
