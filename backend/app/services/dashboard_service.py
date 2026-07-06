from sqlalchemy.orm import Session
from app.services import quote_service, po_service, account_service
from app.schemas.schemas import DashboardSummary


def get_summary(db: Session) -> DashboardSummary:
    quotes = quote_service.list_quotes(db)
    pos = po_service.list_pos(db)
    accounts = account_service.list_accounts(db)

    total_quotes = len(quotes)
    total_quote_value = sum(q.quote_value or 0 for q in quotes)
    avg_quote_value = total_quote_value / total_quotes if total_quotes > 0 else 0

    by_status = {}
    for q in quotes:
        key = q.status.value if hasattr(q.status, "value") else str(q.status)
        by_status[key] = by_status.get(key, 0) + 1

    stalled_count = by_status.get("Stalled", 0)

    return DashboardSummary(
        total_quotes=total_quotes,
        total_quote_value=total_quote_value,
        avg_quote_value=avg_quote_value,
        by_status=by_status,
        stalled_count=stalled_count,
        total_po_value=sum(p.po_value or 0 for p in pos),
        total_accounts=len(accounts),
    )
