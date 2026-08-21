"""
Endpoints triggered by Vercel Cron, not by a logged-in manager. Kept in
their own router with their own auth (CRON_SECRET), separate from every
other router's Depends(verify_token) — reusing the manager's shared
password here would mean it sits in a Vercel env var, which the actual
password shouldn't be exposed to.
"""
import os
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import sdr_kpi_ingest_service
from app.services import sample_service

router = APIRouter(prefix="/api/cron", tags=["cron"])
PST = ZoneInfo("America/Los_Angeles")


def verify_cron_secret(authorization: str = Header(None)):
    """Vercel automatically sends `Authorization: Bearer <CRON_SECRET>`
    when CRON_SECRET is set as an env var — this is Vercel's documented
    cron-security convention, not something built from scratch here."""
    secret = os.getenv("CRON_SECRET", "")
    if not secret:
        raise HTTPException(status_code=500, detail="CRON_SECRET not configured")
    if authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Invalid or missing cron secret")


@router.get("/ingest-sdr-performance", dependencies=[Depends(verify_cron_secret)])
def ingest_sdr_performance(target_date: str = None, db: Session = Depends(get_db)):
    """Vercel Cron triggers this with a GET request (confirmed against
    Vercel's docs — cron jobs are always GET, never POST). Defaults to
    yesterday IN PST, computed explicitly via PST wall-clock time — not
    the serverless runtime's own timezone (date.today() would be UTC on
    Vercel, which can silently be off by a day depending on trigger time).
    Same discipline sdr-daily-report's fetch_calls.py already uses. The
    query param exists for manual backfills/reruns, not normal operation."""
    if target_date:
        d = date.fromisoformat(target_date)
    else:
        d = (datetime.now(PST) - timedelta(days=1)).date()
    return sdr_kpi_ingest_service.ingest_day(db, d)


@router.get("/sync-requested-samples", dependencies=[Depends(verify_cron_secret)])
def sync_requested_samples(db: Session = Depends(get_db)):
    """Safety net for the SDR form's HubSpot sync: the submit endpoint fires
    it via BackgroundTasks so the SDR never waits, but a Vercel function can
    be frozen right after the response is sent, so anything that didn't
    finish (or hit a transient HubSpot error) is retried here."""
    return sample_service.batch_sync_requested_to_hubspot(db)


@router.get("/sync-tracking", dependencies=[Depends(verify_cron_secret)])
def sync_tracking(db: Session = Depends(get_db)):
    """Daily Shippo tracking check for every sample with a tracking number +
    carrier on file and no terminal tracking status yet. Auto-advances a
    record's status to In Transit/Delivered/Returned/Delivery issue based
    on Shippo's real carrier status — see sample_service.STATUS_TRANSITIONS."""
    return sample_service.sync_tracking_statuses(db)
