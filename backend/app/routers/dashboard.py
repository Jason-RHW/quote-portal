from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import dashboard_service
from app.schemas.schemas import DashboardSummary

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def get_summary(db: Session = Depends(get_db)):
    return dashboard_service.get_summary(db)
