from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import quote_service
from app.schemas.schemas import QuoteCreate, QuoteUpdate, QuoteOut

router = APIRouter(prefix="/api/quotes", tags=["quotes"])


@router.get("", response_model=List[QuoteOut])
def list_quotes(status: Optional[str] = None, db: Session = Depends(get_db)):
    return quote_service.list_quotes(db, status=status)


@router.post("", response_model=QuoteOut)
def create_quote(data: QuoteCreate, db: Session = Depends(get_db)):
    return quote_service.create_quote(db, data)


@router.get("/{quote_id}", response_model=QuoteOut)
def get_quote(quote_id: str, db: Session = Depends(get_db)):
    quote = quote_service.get_quote(db, quote_id)
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    return quote


@router.patch("/{quote_id}", response_model=QuoteOut)
def update_quote(quote_id: str, data: QuoteUpdate, db: Session = Depends(get_db)):
    quote = quote_service.update_quote(db, quote_id, data)
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    return quote


@router.delete("/{quote_id}")
def delete_quote(quote_id: str, db: Session = Depends(get_db)):
    if not quote_service.delete_quote(db, quote_id):
        raise HTTPException(status_code=404, detail="Quote not found")
    return {"ok": True}
