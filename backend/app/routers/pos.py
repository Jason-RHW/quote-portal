from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import po_service
from app.schemas.schemas import POCreate, POUpdate, POOut

router = APIRouter(prefix="/api/pos", tags=["purchase orders"])


@router.get("", response_model=List[POOut])
def list_pos(db: Session = Depends(get_db)):
    return po_service.list_pos(db)


@router.post("", response_model=POOut)
def create_po(data: POCreate, db: Session = Depends(get_db)):
    return po_service.create_po(db, data)


@router.get("/{po_id}", response_model=POOut)
def get_po(po_id: str, db: Session = Depends(get_db)):
    po = po_service.get_po(db, po_id)
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    return po


@router.patch("/{po_id}", response_model=POOut)
def update_po(po_id: str, data: POUpdate, db: Session = Depends(get_db)):
    po = po_service.update_po(db, po_id, data)
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    return po


@router.delete("/{po_id}")
def delete_po(po_id: str, db: Session = Depends(get_db)):
    if not po_service.delete_po(db, po_id):
        raise HTTPException(status_code=404, detail="PO not found")
    return {"ok": True}
