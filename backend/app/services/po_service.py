from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy.orm import Session

from app.models.db_models import PurchaseOrder
from app.schemas.schemas import POCreate, POUpdate


def list_pos(db: Session) -> List[PurchaseOrder]:
    return db.query(PurchaseOrder).order_by(PurchaseOrder.date_of_po.desc().nullslast()).all()


def get_po(db: Session, po_id: str) -> Optional[PurchaseOrder]:
    return db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).first()


def create_po(db: Session, data: POCreate) -> PurchaseOrder:
    extra = data.extra or {}
    if data.associated_sdr:
        extra["associated_sdr"] = data.associated_sdr

    po = PurchaseOrder(
        business_name=data.business_name,
        po_value=data.po_value,
        date_of_po=data.date_of_po,
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
