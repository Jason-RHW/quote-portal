from typing import List
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import po_service, po_extraction_service
from app.schemas.schemas import POCreate, POUpdate, POOut, POExtractionResult

router = APIRouter(prefix="/api/pos", tags=["purchase orders"])

MAX_PDF_BYTES = 10 * 1024 * 1024  # 10MB


@router.get("", response_model=List[POOut])
def list_pos(db: Session = Depends(get_db)):
    return po_service.list_pos(db)


@router.post("/extract-pdf", response_model=POExtractionResult)
async def extract_po_pdf(file: UploadFile = File(...)):
    """Reads an uploaded PDF PO and returns an AI-extracted draft — never
    persisted here. The frontend seeds the New PO form with this result;
    a manager still has to review it and hit Save to actually create a PO."""
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Please upload a PDF file.")
    contents = await file.read()
    if len(contents) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF is too large (10MB max).")
    try:
        return po_extraction_service.extract_po_from_pdf(contents, filename=file.filename or "purchase_order.pdf")
    except po_extraction_service.ExtractionError as e:
        raise HTTPException(status_code=422, detail=str(e))


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
