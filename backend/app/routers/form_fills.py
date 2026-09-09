from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import form_fill_service
from app.schemas.schemas import FormFillOut, FormFillCreate, FormFillUpdate

router = APIRouter(prefix="/api/form-fills", tags=["form-fills"])


@router.get("", response_model=List[FormFillOut])
def list_form_fills(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    sdr_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    return form_fill_service.list_form_fills(db, start_date=start_date, end_date=end_date, sdr_id=sdr_id)


@router.post("", response_model=FormFillOut)
def create_form_fill(data: FormFillCreate, db: Session = Depends(get_db)):
    try:
        return form_fill_service.create_form_fill(db, data.model_dump(), data.created_by)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.patch("/{form_fill_id}", response_model=FormFillOut)
def update_form_fill(form_fill_id: str, data: FormFillUpdate, db: Session = Depends(get_db)):
    try:
        row = form_fill_service.update_form_fill(db, form_fill_id, data.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if not row:
        raise HTTPException(status_code=404, detail="Form fill not found.")
    return row


@router.delete("/{form_fill_id}")
def delete_form_fill(form_fill_id: str, db: Session = Depends(get_db)):
    deleted = form_fill_service.delete_form_fill(db, form_fill_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Form fill not found.")
    return {"deleted": True}
