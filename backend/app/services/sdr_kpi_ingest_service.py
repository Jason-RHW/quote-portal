"""
Quote Portal's independent Aircall ingest — fetches and computes KPIs on
its own schedule (Vercel Cron), using sdr_kpi_lib so these numbers can
never diverge from what sdr-daily-report computes for the PDF/email. A
parallel data path to that repo, not a dependency on it.

Deliberately NOT computed here: samples, quotes, convert rate. All three
are computed live at read time in sdr_performance_service.py, since they
either come from this backend's own tables (quotes, sample_requests) or
are derived by combining Aircall data with those tables — no single
ingest path has both halves. This module only ever writes calls /
connect_pct / active_hrs / call-type mix / clock data: purely
Aircall-derived numbers, nothing else.
"""
from datetime import date, timedelta, datetime
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session
from sdr_kpi_lib import compute_sdr_kpis

from app.services import aircall_client
from app.config.sdr_aircall_config import AIRCALL_USER_MAP, CONNECTED_TAGS, TERMINATED_SDRS
from app.models.db_models import DailySummary, SdrDailyStat

PST = ZoneInfo("America/Los_Angeles")


def _decimal_hour_pst(ts: float) -> float:
    """Raw Aircall unix timestamp -> decimal hour-of-day in PST, e.g.
    7:55 AM PST -> 7.9167. This is the wire format the API/frontend
    already expect (ClockDial.jsx, SdrClockOut schema) — matches
    sdr-daily-report's chart_svg.py, which does the equivalent conversion
    via datetime.fromtimestamp(ts, tz=PST) at render time instead of at
    write time. Converting once here, at ingest, means the already-tested
    API contract downstream doesn't need to change."""
    dt = datetime.fromtimestamp(ts, tz=PST)
    return dt.hour + dt.minute / 60 + dt.second / 3600


def _delta(curr: float, prev: Optional[float]) -> Optional[dict]:
    """Relative percent change — for count metrics (calls, active hours).
    Returns dir='flat' on a genuine zero change rather than defaulting to
    'up', so the frontend can render a neutral dash instead of a colored
    arrow for "nothing happened"."""
    if prev is None or prev == 0:
        return None
    pct = round(abs((curr - prev) / prev) * 100, 1)
    if pct == 0:
        return {"dir": "flat", "pct": 0}
    return {"dir": "up" if curr > prev else "down", "pct": pct}


def _delta_pp(curr: float, prev: Optional[float]) -> Optional[dict]:
    """Percentage-point difference — for rate metrics (connect %). curr/prev
    are already percentages, so the plain difference is the right number,
    not a relative percent-of-percent calculation."""
    if prev is None:
        return None
    diff = round(curr - prev, 1)
    if diff == 0:
        return {"dir": "flat", "pct": 0}
    return {"dir": "up" if diff > 0 else "down", "pct": abs(diff)}


def _previous_working_date(db: Session, before: date) -> Optional[date]:
    """The most recent date strictly before `before` that actually has a
    written report — not just literal yesterday, and not just "skip
    Sat/Sun" (which misses holidays or any other gap). Same definition
    used in sdr_performance_service.py's daily read path, so the two
    files never disagree about what "previous working day" means."""
    row = (
        db.query(DailySummary.report_date)
        .filter(DailySummary.report_date < before)
        .order_by(DailySummary.report_date.desc())
        .first()
    )
    return row[0] if row else None


def ingest_day(db: Session, target_date: date) -> dict:
    """Fetch, compute, and upsert one day's Aircall KPIs. Idempotent —
    running it twice for the same date overwrites, not duplicates
    (upsert on report_date / (report_date, sdr_name)). Returns a summary
    dict for logging, not the full report shape the dashboard reads."""
    calls = aircall_client.fetch_calls_for_day(target_date)
    kpis_by_sdr = compute_sdr_kpis(calls, AIRCALL_USER_MAP, CONNECTED_TAGS, TERMINATED_SDRS)

    # "Unassigned (...)" buckets are a data-quality signal, not a person —
    # same rule sdr-daily-report uses, no row gets written for them.
    real_sdrs = {name: k for name, k in kpis_by_sdr.items() if not name.startswith("Unassigned")}
    unassigned_buckets = [n for n in kpis_by_sdr if n.startswith("Unassigned")]

    prev_date = _previous_working_date(db, target_date)
    prev_summary = db.query(DailySummary).filter(DailySummary.report_date == prev_date).first() if prev_date else None
    prev_stats = {
        s.sdr_name: s for s in (
            db.query(SdrDailyStat).filter(SdrDailyStat.report_date == prev_date).all() if prev_date else []
        )
    }

    team_calls = sum(k["total_calls"] for k in real_sdrs.values())
    team_connected = sum(k["call_types"]["connected"] for k in real_sdrs.values())
    team_connect_pct = round(team_connected / team_calls * 100, 1) if team_calls else 0.0
    # Average per SDR, not a team-wide sum — a sum mechanically grows with
    # headcount (3 SDRs at the same individual pace as 2 would always show
    # a bigger number) without anyone actually working differently. This
    # also makes it consistent with team_connect_pct/convert above, which
    # were always per-SDR-style rates, not raw totals.
    team_active_hrs = round(
        sum(k["active_hrs"] for k in real_sdrs.values()) / len(real_sdrs), 2
    ) if real_sdrs else 0.0

    team_deltas = {}
    for key, curr, prev in [
        ("calls", team_calls, prev_summary.calls if prev_summary else None),
        ("activeHrs", team_active_hrs, prev_summary.active_hrs if prev_summary else None),
    ]:
        d = _delta(curr, prev)
        if d:
            team_deltas[key] = d
    connect_delta = _delta_pp(team_connect_pct, prev_summary.connect_pct if prev_summary else None)
    if connect_delta:
        team_deltas["connect"] = connect_delta

    summary = db.query(DailySummary).filter(DailySummary.report_date == target_date).first()
    if not summary:
        summary = DailySummary(report_date=target_date)
        db.add(summary)
    summary.calls = team_calls
    summary.connect_pct = team_connect_pct
    summary.active_hrs = team_active_hrs
    summary.deltas = team_deltas

    for name, k in real_sdrs.items():
        total = k["total_calls"]
        connected_pct = round(k["call_types"]["connected"] / total * 100, 1) if total else 0.0
        voicemail_pct = round(k["call_types"]["voicemail"] / total * 100, 1) if total else 0.0
        other_pct = round(k["call_types"]["other"] / total * 100, 1) if total else 0.0

        prev_stat = prev_stats.get(name)
        sdr_deltas = {}
        for key, curr, prev in [
            ("connected", connected_pct, prev_stat.connected_pct if prev_stat else None),
            ("voicemail", voicemail_pct, prev_stat.voicemail_pct if prev_stat else None),
            ("other", other_pct, prev_stat.other_pct if prev_stat else None),
        ]:
            d = _delta_pp(curr, prev)
            if d:
                sdr_deltas[key] = d

        row = db.query(SdrDailyStat).filter(
            SdrDailyStat.report_date == target_date, SdrDailyStat.sdr_name == name
        ).first()
        if not row:
            row = SdrDailyStat(report_date=target_date, sdr_name=name)
            db.add(row)
        row.calls = total
        row.connected_pct = connected_pct
        row.voicemail_pct = voicemail_pct
        row.other_pct = other_pct
        row.span_start = _decimal_hour_pst(k["span_start"]) if k["span_start"] is not None else None
        row.span_end = _decimal_hour_pst(k["span_end"]) if k["span_end"] is not None else None
        row.active_chunks = k["active_chunks"]
        row.active_hrs = k["active_hrs"]
        row.idle_hrs = (
            max(0.0, round(k["call_span_hrs"] - k["active_hrs"], 2)) if k["span_start"] is not None else 0.0
        )
        row.deltas = sdr_deltas

    db.commit()

    return {
        "date": target_date.isoformat(),
        "team_calls": team_calls,
        "sdr_count": len(real_sdrs),
        "unassigned_buckets": unassigned_buckets,
    }
