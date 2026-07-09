from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import sdr_performance_service as svc
from app.schemas.schemas import SdrPerformanceReportOut, AvailablePeriodsOut

router = APIRouter(prefix="/api/sdr-performance", tags=["sdr-performance"])


@router.get("/periods", response_model=AvailablePeriodsOut)
def available_periods(db: Session = Depends(get_db)):
    """Which dates/weeks/months actually have a report. Drives the
    calendar and dropdown selectors — the frontend never offers a period
    that doesn't exist here."""
    return svc.get_available_periods(db)


@router.get("/daily/{date_str}", response_model=SdrPerformanceReportOut)
def daily(date_str: str, db: Session = Depends(get_db)):
    report = svc.get_daily_report(db, date_str)
    if not report:
        raise HTTPException(status_code=404, detail="No report for this date")
    return report


@router.get("/weekly/{week_key}", response_model=SdrPerformanceReportOut)
def weekly(week_key: str, db: Session = Depends(get_db)):
    report = svc.get_weekly_report(db, week_key)
    if not report:
        raise HTTPException(status_code=404, detail="No report for this week")
    return report


@router.get("/monthly/{month_key}", response_model=SdrPerformanceReportOut)
def monthly(month_key: str, db: Session = Depends(get_db)):
    report = svc.get_monthly_report(db, month_key)
    if not report:
        raise HTTPException(status_code=404, detail="No report for this month")
    return report
