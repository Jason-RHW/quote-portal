from typing import Optional, List
from sqlalchemy.orm import Session

from app.models.db_models import AccountRegistration
from app.schemas.schemas import AccountRegCreate, AccountRegUpdate


def list_accounts(db: Session) -> List[AccountRegistration]:
    return db.query(AccountRegistration).order_by(
        AccountRegistration.registration_date.desc().nullslast()
    ).all()


def get_account(db: Session, account_id: str) -> Optional[AccountRegistration]:
    return db.query(AccountRegistration).filter(AccountRegistration.id == account_id).first()


def create_account(db: Session, data: AccountRegCreate) -> AccountRegistration:
    account = AccountRegistration(**data.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def update_account(db: Session, account_id: str, data: AccountRegUpdate) -> Optional[AccountRegistration]:
    account = get_account(db, account_id)
    if not account:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    return account


def delete_account(db: Session, account_id: str) -> bool:
    account = get_account(db, account_id)
    if not account:
        return False
    db.delete(account)
    db.commit()
    return True
