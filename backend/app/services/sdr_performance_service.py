"""
SDR Performance dashboard — read-side service.

Data sources:
1. `sdr_daily_summary` / `sdr_daily_stats` — written once a day by the
   separate sdr-daily-report GitHub Actions pipeline (Aircall-derived:
   calls, connect rate, active hours, the clock chart). This service only
   reads them.
2. `quotes` and `sample_requests` — this backend's own tables. Both are
   computed here in plain Python over the already-fetched row list. Quotes
   mirrors exactly how DashboardPage.jsx already computes its per-SDR
   breakdown client-side; samples uses the same pattern for the same
   reason — it's a business record with a status, not Aircall call-log
   data, so it doesn't belong in the pipeline at all.

   Samples are attributed by `requested_date` (when the SDR filled out the
   request, including historical backfill date) rather than `sent_date`
   (when it shipped) — sent_date depends on warehouse/shipping timing the
   SDR doesn't control, and the KPI is meant to measure the SDR's work,
   not fulfillment speed.

Weekly/monthly are NOT separate tables. They're computed here by
aggregating the daily rows over a date range, so there's only ever one
write path (the daily pipeline) to keep in sync.

Known approximation, flagged rather than hidden: `sdr_daily_stats` stores
connected/voicemail/other as *percentages*, not absolute counts. Weekly and
monthly aggregates below use a calls-weighted average of those percentages,
which is more correct than a naive average but not as exact as if we stored
absolute counts and re-derived percentages from sums. Revisit if this ever
needs to be precise to the decimal for a compliance/reporting reason —
switching sdr_daily_stats to store counts instead of percentages would
remove the approximation entirely.
"""
from datetime import date, timedelta
from typing import Optional, List, Dict, Tuple
from collections import defaultdict

from sqlalchemy.orm import Session

from app.models.db_models import DailySummary, SdrDailyStat, SampleRequest, Sdr
from app.services import quote_service


# ── Delta helpers ────────────────────────────────────────────────────
# Two different kinds of delta, deliberately not the same function:
#
# _delta (relative percent change) is for count metrics — calls, samples,
# quotes, active hours. "Calls went from 100 to 120" is meaningfully
# described as "+20%".
#
# _delta_pp (percentage-point difference) is for metrics that are
# THEMSELVES a percentage — connect rate, convert rate. "Connect rate went
# from 20% to 25%" is a 5-point move, not "+25%" (which is what naive
# relative-percent math would say, and which reads as a much bigger,
# wrong-feeling change than what actually happened).
#
# Both return dir="flat" when the value didn't meaningfully move, rather
# than defaulting to "up" — a 0% change is not the same claim as "went up
# by zero", and the frontend renders "flat" as a neutral dash with no
# color, not a colored arrow.
def _delta(curr: float, prev: Optional[float]) -> Optional[dict]:
    if prev is None or prev == 0:
        return None  # no prior data (or prior was zero) — frontend renders this as "—"
    pct = round(abs((curr - prev) / prev) * 100, 1)
    if pct == 0:
        return {"dir": "flat", "pct": 0}
    return {"dir": "up" if curr > prev else "down", "pct": pct}


def _delta_pp(curr: float, prev: Optional[float]) -> Optional[dict]:
    """Percentage-point difference for rate metrics (connect %, convert %).
    curr/prev are already percentages (e.g. 20.0 for 20%), so the
    difference itself — not divided by prev — is the right number."""
    if prev is None:
        return None
    diff = round(curr - prev, 1)
    if diff == 0:
        return {"dir": "flat", "pct": 0}
    return {"dir": "up" if diff > 0 else "down", "pct": abs(diff)}


# ── Quote counts (mirrors DashboardPage.jsx's client-side pattern) ─────
def _quotes_by_sdr(db: Session, start: date, end: date) -> Tuple[Dict[str, int], int]:
    """Quotes with an SDR assigned, requested within [start, end] inclusive.
    Deliberately excludes unassigned quotes — unlike the main Quote
    Dashboard, which buckets them as "Unassigned" and includes them."""
    quotes = quote_service.list_quotes(db)
    counts: Dict[str, int] = defaultdict(int)
    total = 0
    for q in quotes:
        if not q.date_requested:
            continue
        d = q.date_requested.date()
        if not (start <= d <= end):
            continue
        sdr = (q.extra or {}).get("associated_sdr")
        if not sdr:
            continue
        counts[sdr] += 1
        total += 1
    return dict(counts), total


def _samples_by_sdr(db: Session, start: date, end: date) -> Tuple[Dict[str, int], int]:
    """Sample requests attributed by requested_date, for [start, end]
    inclusive. That keeps historical Excel imports and live SDR form
    submissions on the same timeline. Same live-query pattern as
    _quotes_by_sdr — see module docstring for why samples doesn't use the
    daily pipeline at all."""
    id_to_name = {s.id: s.full_name for s in db.query(Sdr).all()}
    rows = (
        db.query(SampleRequest)
        .filter(SampleRequest.requested_date.between(start, end))
        .all()
    )
    counts: Dict[str, int] = defaultdict(int)
    total = 0
    for r in rows:
        if not r.sdr_id:
            continue
        name = id_to_name.get(r.sdr_id)
        if not name:
            continue
        counts[name] += 1
        total += 1
    return dict(counts), total


def _prior_range(start: date, end: date) -> Tuple[date, date]:
    """The immediately preceding period of the same length, for deltas."""
    span = (end - start).days + 1
    prior_end = start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=span - 1)
    return prior_start, prior_end


# ── Available periods (drives the calendar / dropdown selectors) ───────
def get_available_periods(db: Session):
    dates = [row[0] for row in db.query(DailySummary.report_date).order_by(DailySummary.report_date).all()]
    daily = [d.isoformat() for d in dates]
    weekly, monthly = [], []
    seen_weeks, seen_months = set(), set()
    for d in dates:
        iso_year, iso_week, _ = d.isocalendar()
        wkey = f"{iso_year}-W{iso_week:02d}"
        if wkey not in seen_weeks:
            seen_weeks.add(wkey)
            weekly.append(wkey)
        mkey = f"{d.year}-{d.month:02d}"
        if mkey not in seen_months:
            seen_months.add(mkey)
            monthly.append(mkey)
    return {"daily": daily, "weekly": sorted(weekly), "monthly": sorted(monthly)}


# ── Daily ────────────────────────────────────────────────────────────
def _previous_working_date(db: Session, before: date) -> Optional[date]:
    """The most recent date strictly before `before` that actually has a
    report — not just literal yesterday. A day with no DailySummary row
    means the pipeline had nothing to report (weekend, holiday, an outage),
    and comparing today's numbers against an empty day always produces a
    meaningless "+infinite%" or misleading swing. Used as the single
    anchor date for every daily delta below, so calls/connect/convert/
    samples/quotes all compare against the same real prior day instead of
    each silently picking a different one."""
    row = (
        db.query(DailySummary.report_date)
        .filter(DailySummary.report_date < before)
        .order_by(DailySummary.report_date.desc())
        .first()
    )
    return row[0] if row else None


def get_daily_report(db: Session, date_str: str) -> Optional[dict]:
    d = date.fromisoformat(date_str)
    summary = db.query(DailySummary).filter(DailySummary.report_date == d).first()
    if not summary:
        return None

    stats = (
        db.query(SdrDailyStat)
        .filter(SdrDailyStat.report_date == d)
        .order_by(SdrDailyStat.calls.desc())
        .all()
    )

    prev_date = _previous_working_date(db, d)

    quotes_today, quotes_total_today = _quotes_by_sdr(db, d, d)
    quotes_prev, quotes_total_prev = _quotes_by_sdr(db, prev_date, prev_date) if prev_date else ({}, 0)
    samples_today, samples_total_today = _samples_by_sdr(db, d, d)
    samples_prev, samples_total_prev = _samples_by_sdr(db, prev_date, prev_date) if prev_date else ({}, 0)

    team_deltas = dict(summary.deltas or {})
    team_deltas["quotes"] = _delta(quotes_total_today, quotes_total_prev) or {"dir": "flat", "pct": 0}
    team_deltas["samples"] = _delta(samples_total_today, samples_total_prev) or {"dir": "flat", "pct": 0}

    team_convert_today = _convert_pct(samples_total_today, summary.calls)
    prev_summary = (
        db.query(DailySummary).filter(DailySummary.report_date == prev_date).first() if prev_date else None
    )
    team_convert_prev = _convert_pct(samples_total_prev, prev_summary.calls) if prev_summary else None
    team_deltas["convert"] = _delta_pp(team_convert_today, team_convert_prev) or {"dir": "flat", "pct": 0}

    sdrs = []
    for s in stats:
        sdr_deltas = s.deltas or {}
        q_today = quotes_today.get(s.sdr_name, 0)
        q_prev = quotes_prev.get(s.sdr_name, 0)
        smp_today = samples_today.get(s.sdr_name, 0)
        smp_prev = samples_prev.get(s.sdr_name, 0)
        convert_today = _convert_pct(smp_today, s.calls)
        prev_stat = None
        if prev_date:
            prev_stat = db.query(SdrDailyStat).filter(
                SdrDailyStat.report_date == prev_date, SdrDailyStat.sdr_name == s.sdr_name
            ).first()
        convert_prev = _convert_pct(smp_prev, prev_stat.calls) if prev_stat else None
        sdrs.append({
            "name": s.sdr_name,
            "calls": s.calls,
            "mix": {
                "connected": s.connected_pct, "voicemail": s.voicemail_pct, "other": s.other_pct,
                "connectedDelta": sdr_deltas.get("connected"),
                "voicemailDelta": sdr_deltas.get("voicemail"),
                "otherDelta": sdr_deltas.get("other"),
            },
            "samples": {"v": smp_today, "delta": _delta(smp_today, smp_prev)},
            "convert": {"v": convert_today, "delta": _delta_pp(convert_today, convert_prev)},
            "quotes": {"v": q_today, "delta": _delta(q_today, q_prev)},
            "clock": {
                "timeLabel": _format_span_label(s.span_start, s.span_end),
                "start": s.span_start, "end": s.span_end,
                "idle": _idle_indices(s.active_chunks),
                "activeHrs": s.active_hrs, "idleHrs": s.idle_hrs,
            } if s.span_start is not None else None,
        })

    return {
        "team": {
            "calls": summary.calls, "connect": summary.connect_pct, "convert": team_convert_today,
            "samples": samples_total_today, "activeHrs": summary.active_hrs, "quotes": quotes_total_today,
            "deltas": team_deltas,
        },
        "sdrs": sdrs,
    }


def _convert_pct(samples: int, calls: int) -> float:
    """Conversion rate = samples / calls. Computed live at read time, not
    written by any pipeline — it inherently combines Aircall-derived calls
    with Quote Portal's own sample_requests, two different data sources
    that no single ingest path has both halves of."""
    return round(samples / calls * 100, 1) if calls else 0.0


def _idle_indices(active_chunks) -> List[int]:
    if not active_chunks:
        return []
    return [i for i, active in enumerate(active_chunks) if not active]


def _format_span_label(start: Optional[float], end: Optional[float]) -> str:
    if start is None or end is None:
        return ""
    def fmt(h):
        hh = int(h) % 12 or 12
        mm = round((h % 1) * 60)
        period = "AM" if int(h) % 24 < 12 else "PM"
        return f"{hh}:{mm:02d} {period}"
    return f"{fmt(start)} → {fmt(end)}"


# ── Weekly / Monthly — aggregated from daily rows on read ──────────────
def _aggregate_range(db: Session, start: date, end: date) -> Optional[dict]:
    summaries = db.query(DailySummary).filter(DailySummary.report_date.between(start, end)).all()
    if not summaries:
        return None
    stats = db.query(SdrDailyStat).filter(SdrDailyStat.report_date.between(start, end)).all()

    n_days = len(summaries)
    team_calls = sum(s.calls for s in summaries)
    # Calls-weighted average for rate metrics — see module docstring.
    team_connect = _weighted_avg([(s.connect_pct, s.calls) for s in summaries])
    team_active_hrs = sum(s.active_hrs for s in summaries) / n_days

    quotes_by_sdr, quotes_total = _quotes_by_sdr(db, start, end)
    samples_by_sdr, samples_total = _samples_by_sdr(db, start, end)
    team_convert = _convert_pct(samples_total, team_calls)

    by_sdr: Dict[str, List[SdrDailyStat]] = defaultdict(list)
    for s in stats:
        by_sdr[s.sdr_name].append(s)

    sdr_rows = []
    for name, rows in by_sdr.items():
        calls = sum(r.calls for r in rows)
        connected = _weighted_avg([(r.connected_pct, r.calls) for r in rows])
        voicemail = _weighted_avg([(r.voicemail_pct, r.calls) for r in rows])
        other = max(0.0, 100 - connected - voicemail)
        sdr_samples = samples_by_sdr.get(name, 0)
        convert = _convert_pct(sdr_samples, calls)
        active_hrs = sum(r.active_hrs for r in rows) / len(rows)
        idle_hrs = sum(r.idle_hrs for r in rows) / len(rows)
        sdr_rows.append({
            "name": name, "calls": calls,
            "mix": {"connected": round(connected, 1), "voicemail": round(voicemail, 1), "other": round(other, 1)},
            "samples": {"v": sdr_samples, "delta": None},
            "convert": {"v": convert, "delta": None},
            "quotes": {"v": quotes_by_sdr.get(name, 0), "delta": None},
            "span8": {"active": round(active_hrs, 1), "idle": round(idle_hrs, 1)},
        })
    sdr_rows.sort(key=lambda r: r["calls"], reverse=True)

    prior_start, prior_end = _prior_range(start, end)
    prior_summaries = db.query(DailySummary).filter(DailySummary.report_date.between(prior_start, prior_end)).all()
    _, prior_quotes_total = _quotes_by_sdr(db, prior_start, prior_end)
    _, prior_samples_total = _samples_by_sdr(db, prior_start, prior_end)
    prior_calls = sum(s.calls for s in prior_summaries) if prior_summaries else None
    prior_connect = _weighted_avg([(s.connect_pct, s.calls) for s in prior_summaries]) if prior_summaries else None
    prior_convert = _convert_pct(prior_samples_total, prior_calls) if prior_calls else None
    prior_active = (sum(s.active_hrs for s in prior_summaries) / len(prior_summaries)) if prior_summaries else None

    team_deltas = {
        "calls": _delta(team_calls, prior_calls) or {"dir": "flat", "pct": 0},
        "connect": _delta_pp(team_connect, prior_connect) or {"dir": "flat", "pct": 0},
        "convert": _delta_pp(team_convert, prior_convert) or {"dir": "flat", "pct": 0},
        "samples": _delta(samples_total, prior_samples_total) or {"dir": "flat", "pct": 0},
        "activeHrs": _delta(team_active_hrs, prior_active) or {"dir": "flat", "pct": 0},
        "quotes": _delta(quotes_total, prior_quotes_total) or {"dir": "flat", "pct": 0},
    }

    return {
        "team": {
            "calls": team_calls, "connect": round(team_connect, 1), "convert": team_convert,
            "samples": samples_total, "activeHrs": round(team_active_hrs, 1), "quotes": quotes_total,
            "deltas": team_deltas,
        },
        "sdrs": sdr_rows,
    }


def _weighted_avg(pairs: List[Tuple[float, int]]) -> float:
    total_weight = sum(w for _, w in pairs)
    if total_weight == 0:
        return 0.0
    return sum(v * w for v, w in pairs) / total_weight


def get_weekly_report(db: Session, week_key: str) -> Optional[dict]:
    iso_year, iso_week = week_key.split("-W")
    start = date.fromisocalendar(int(iso_year), int(iso_week), 1)
    end = start + timedelta(days=6)
    return _aggregate_range(db, start, end)


def get_monthly_report(db: Session, month_key: str) -> Optional[dict]:
    year, month = (int(p) for p in month_key.split("-"))
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) - timedelta(days=1) if month == 12 else date(year, month + 1, 1) - timedelta(days=1)
    return _aggregate_range(db, start, end)
