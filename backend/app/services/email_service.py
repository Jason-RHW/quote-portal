import os
import smtplib
from email.message import EmailMessage
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.db_models import FormField, Sdr, SampleRequest, Quote


class EmailSendError(Exception):
    pass


def _recipients() -> List[str]:
    raw = os.getenv("SAMPLE_REQUEST_NOTIFICATION_EMAILS", "")
    return [addr.strip() for addr in raw.split(",") if addr.strip()]


def _quote_request_recipients() -> List[str]:
    # Falls back to the sample request list so a single Vercel env var
    # (SAMPLE_REQUEST_NOTIFICATION_EMAILS) covers both notification types
    # unless QUOTE_REQUEST_NOTIFICATION_EMAILS is explicitly set to something different.
    raw = os.getenv("QUOTE_REQUEST_NOTIFICATION_EMAILS", "")
    recipients = [addr.strip() for addr in raw.split(",") if addr.strip()]
    return recipients or _recipients()


def is_configured() -> bool:
    return bool(
        os.getenv("SMTP_HOST")
        and os.getenv("SMTP_USERNAME")
        and os.getenv("SMTP_PASSWORD")
        and _recipients()
    )


def is_quote_request_configured() -> bool:
    return bool(
        os.getenv("SMTP_HOST")
        and os.getenv("SMTP_USERNAME")
        and os.getenv("SMTP_PASSWORD")
        and _quote_request_recipients()
    )


def send_email(subject: str, body_text: str, to_emails: List[str]) -> None:
    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    username = os.getenv("SMTP_USERNAME")
    password = os.getenv("SMTP_PASSWORD")
    from_email = os.getenv("SMTP_FROM_EMAIL") or username
    use_tls = os.getenv("SMTP_USE_TLS", "true").lower() != "false"

    if not (host and username and password and to_emails):
        raise EmailSendError("SMTP is not fully configured (host/username/password/recipients).")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = from_email
    message["To"] = ", ".join(to_emails)
    message.set_content(body_text)

    try:
        with smtplib.SMTP(host, port, timeout=20) as server:
            if use_tls:
                server.starttls()
            server.login(username, password)
            server.send_message(message)
    except (smtplib.SMTPException, OSError) as exc:
        raise EmailSendError(f"Failed to send email via {host}:{port}: {exc}") from exc


def _field_labels(db: Session) -> dict:
    return {f.field_key: f.label for f in db.query(FormField).order_by(FormField.sort_order).all()}


def _format_value(value) -> str:
    if isinstance(value, list):
        return ", ".join(str(v) for v in value) if value else "—"
    if value is None or value == "":
        return "—"
    return str(value)


def _sdr_name(db: Session, sdr_id: Optional[str]) -> str:
    if not sdr_id:
        return "—"
    sdr = db.query(Sdr).filter(Sdr.id == sdr_id).first()
    return sdr.full_name if sdr else "—"


def build_sample_request_notification(db: Session, req: SampleRequest) -> tuple:
    subject = f"New Sample Request — {req.business_name}"

    lines = [
        f"Requested by: {_sdr_name(db, req.sdr_id)}",
        f"Date requested: {req.requested_date.isoformat() if req.requested_date else '—'}",
        "",
        "Contact & Business",
        f"  Name: {_format_value(req.contact_name)}",
        f"  Email: {_format_value(req.contact_email)}",
        f"  Phone: {_format_value(req.contact_phone)}",
        f"  Business name: {_format_value(req.business_name)}",
        f"  Address: {_format_value(req.address_line)}",
        f"  City: {_format_value(req.city)}",
        f"  State: {_format_value(req.state)}",
        f"  Zip code: {_format_value(req.zip_code)}",
        "",
        "Glove Specs",
    ]

    labels = _field_labels(db)
    custom_fields = req.custom_fields or {}
    for field_key, label in labels.items():
        if field_key in custom_fields:
            lines.append(f"  {label}: {_format_value(custom_fields[field_key])}")

    frontend_url = os.getenv("FRONTEND_URL")
    if frontend_url:
        lines += ["", f"Review and assign a brand: {frontend_url}"]

    return subject, "\n".join(lines)


def send_sample_request_notification(db: Session, req: SampleRequest) -> None:
    subject, body = build_sample_request_notification(db, req)
    send_email(subject, body, _recipients())


def build_quote_request_notification(quote: Quote) -> tuple:
    subject = f"New Quote Request — {quote.business_name}"

    associated_sdr = (quote.extra or {}).get("associated_sdr")

    lines = [
        f"Requested by: {_format_value(associated_sdr)}",
        f"Date requested: {quote.date_requested.isoformat() if quote.date_requested else '—'}",
        "",
        "Contact & Business",
        f"  Contact name: {_format_value(quote.requested_by)}",
        f"  Email: {_format_value(quote.contact_email)}",
        f"  Phone: {_format_value(quote.contact_phone)}",
        f"  Business name: {_format_value(quote.business_name)}",
    ]

    line_items = (quote.extra or {}).get("line_items") or []
    if line_items:
        lines += ["", "Brand line items"]
        for item in line_items:
            sku = f", SKU {item['sku']}" if item.get("sku") else ""
            cases = f", {item['cases']} cases" if item.get("cases") else ""
            lines.append(f"  {item['brand']}{sku}{cases}")

    if quote.notes:
        lines += ["", "Note", f"  {quote.notes}"]

    frontend_url = os.getenv("FRONTEND_URL")
    if frontend_url:
        lines += ["", f"Review in the Quotes page: {frontend_url}"]

    return subject, "\n".join(lines)


def send_quote_request_notification(quote: Quote) -> None:
    subject, body = build_quote_request_notification(quote)
    send_email(subject, body, _quote_request_recipients())
