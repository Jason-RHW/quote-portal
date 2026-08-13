from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy.orm import Session

from app.models.db_models import PurchaseOrder
from app.schemas.schemas import POCreate, POUpdate


def _line_items_subtotal(line_items) -> float:
    return round(sum((item.quantity or 0) * (item.unit_price or 0) for item in line_items), 2)


def list_pos(db: Session) -> List[PurchaseOrder]:
    return db.query(PurchaseOrder).order_by(PurchaseOrder.date_of_po.desc().nullslast()).all()


def get_po(db: Session, po_id: str) -> Optional[PurchaseOrder]:
    return db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).first()


def create_po(db: Session, data: POCreate) -> PurchaseOrder:
    extra = data.extra or {}
    if data.associated_sdr:
        extra["associated_sdr"] = data.associated_sdr

    po_value = data.po_value
    if data.line_items:
        extra["line_items"] = [item.model_dump() for item in data.line_items]
        po_value = _line_items_subtotal(data.line_items)

    po = PurchaseOrder(
        business_name=data.business_name,
        po_number=data.po_number,
        ship_to=data.ship_to,
        po_value=po_value,
        date_of_po=data.date_of_po,
        status=data.status,
        quote_id=data.quote_id,
        extra=extra,
    )
    db.add(po)
    db.commit()
    db.refresh(po)
    return po


def update_po(db: Session, po_id: str, data: POUpdate) -> Optional[PurchaseOrder]:
    po = get_po(db, po_id)
    if not po:
        return None

    update_data = data.model_dump(exclude_unset=True)

    if "associated_sdr" in update_data:
        extra = dict(po.extra or {})
        sdr = update_data.pop("associated_sdr")
        if sdr:
            extra["associated_sdr"] = sdr
        else:
            extra.pop("associated_sdr", None)
        po.extra = extra

    if "line_items" in update_data:
        line_items = update_data.pop("line_items")
        extra = dict(po.extra or {})
        if line_items:
            extra["line_items"] = line_items
            update_data["po_value"] = _line_items_subtotal(data.line_items)
        else:
            extra.pop("line_items", None)
        po.extra = extra

    for field, value in update_data.items():
        setattr(po, field, value)

    po.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(po)
    return po


def delete_po(db: Session, po_id: str) -> bool:
    po = get_po(db, po_id)
    if not po:
        return False
    db.delete(po)
    db.commit()
    return True
