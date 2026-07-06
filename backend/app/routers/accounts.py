from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import account_service
from app.schemas.schemas import AccountRegCreate, AccountRegUpdate, AccountRegOut

router = APIRouter(prefix="/api/accounts", tags=["account registrations"])


@router.get("", response_model=List[AccountRegOut])
def list_accounts(db: Session = Depends(get_db)):
    return account_service.list_accounts(db)


@router.post("", response_model=AccountRegOut)
def create_account(data: AccountRegCreate, db: Session = Depends(get_db)):
    return account_service.create_account(db, data)


@router.get("/{account_id}", response_model=AccountRegOut)
def get_account(account_id: str, db: Session = Depends(get_db)):
    account = account_service.get_account(db, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.patch("/{account_id}", response_model=AccountRegOut)
def update_account(account_id: str, data: AccountRegUpdate, db: Session = Depends(get_db)):
    account = account_service.update_account(db, account_id, data)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


@router.delete("/{account_id}")
def delete_account(account_id: str, db: Session = Depends(get_db)):
    if not account_service.delete_account(db, account_id):
        raise HTTPException(status_code=404, detail="Account not found")
    return {"ok": True}
