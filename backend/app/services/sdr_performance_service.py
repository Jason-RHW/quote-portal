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

   Samples are attributed by `created_at` (when the request record was
   created) rather than fulfillment dates. For historical Supabase rows,
   created_at is the source of truth for the real submitted date.

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
from datetime import date, datetime, time, timedelta
from typing import Optional, List, Dict, Tuple
from collections import defaultdict
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models.db_models import DailySummary, SdrDailyStat, SampleRequest, Sdr, SdrFormFill
from app.services import quote_service
from app.services.spiff_service import EXCLUDED_COMMISSION_SDRS as EXCLUDED_SDR_NAMES

PST = ZoneInfo("America/Los_Angeles")


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
    """Sample requests attributed by created_at date, for [start, end]
    inclusive. Same live-query pattern as _quotes_by_sdr — see module
    docstring for why samples doesn't use the daily pipeline at all."""
    id_to_name = {s.id: s.full_name for s in db.query(Sdr).all()}
    start_dt = datetime.combine(start, time.min)
    end_dt = datetime.combine(end + timedelta(days=1), time.min)
    rows = (
        db.query(SampleRequest)
        .filter(SampleRequest.created_at >= start_dt)
        .filter(SampleRequest.created_at < end_dt)
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


def _form_fills_by_sdr(db: Session, start: date, end: date) -> Tuple[Dict[str, int], int]:
    """SDR form fills (HubSpot account-research notes — see
    hubspot_formfill_ingest_service.py), attributed by fill_date, for
    [start, end] inclusive. Same live-query pattern as _samples_by_sdr.

    str(...) on both sides of the lookup: production's sdrs.id is a native
    Postgres uuid column (psycopg returns uuid.UUID), while
    sdr_form_fills.sdr_id is a plain varchar column — comparing/hashing
    them directly never matches, silently dropping every form fill from
    this report. Same bug class already fixed for commission_deals/
    commission_meetings in spiff_service.py."""
    id_to_name = {str(s.id): s.full_name for s in db.query(Sdr).all()}
    rows = (
        db.query(SdrFormFill)
        .filter(SdrFormFill.deleted_at.is_(None))
        .filter(SdrFormFill.fill_date >= start, SdrFormFill.fill_date <= end)
        .all()
    )
    counts: Dict[str, int] = defaultdict(int)
    total = 0
    for r in rows:
        if not r.sdr_id:
            continue
        name = id_to_name.get(str(r.sdr_id))
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
    # Today has no DailySummary row yet (the Aircall pipeline reports
    # yesterday's day only once it's fully over) but form fills/samples/
    # quotes are all live queries with real data available right now —
    # so "today" is always selectable in the Daily view, even before
    # tonight's pipeline run backfills its calls/connect/active-hours.
    today_pst = datetime.now(PST).date()
    if today_pst not in dates:
        dates = sorted(dates + [today_pst])
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
    # A day genuinely has "no report" (weekend/holiday/outage) only when
    # it's a *past* day the pipeline skipped — still a 404 for those. But
    # today always renders, with calls/connect/active-hours at 0 until
    # tonight's pipeline run fills them in — samples/quotes/form fills
    # below are live queries and already have real same-day data.
    is_today = d == datetime.now(PST).date()
    if not summary and not is_today:
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
    form_fills_today, form_fills_total_today = _form_fills_by_sdr(db, d, d)
    form_fills_prev, form_fills_total_prev = _form_fills_by_sdr(db, prev_date, prev_date) if prev_date else ({}, 0)

    team_deltas = dict((summary.deltas or {}) if summary else {})
    team_deltas["quotes"] = _delta(quotes_total_today, quotes_total_prev) or {"dir": "flat", "pct": 0}
    team_deltas["samples"] = _delta(samples_total_today, samples_total_prev) or {"dir": "flat", "pct": 0}
    team_deltas["formFills"] = _delta(form_fills_total_today, form_fills_total_prev) or {"dir": "flat", "pct": 0}

    team_calls = summary.calls if summary else 0
    team_convert_today = _convert_pct(samples_total_today, team_calls)
    prev_summary = (
        db.query(DailySummary).filter(DailySummary.report_date == prev_date).first() if prev_date else None
    )
    team_convert_prev = _convert_pct(samples_total_prev, prev_summary.calls) if prev_summary else None
    team_deltas["convert"] = _delta_pp(team_convert_today, team_convert_prev) or {"dir": "flat", "pct": 0}

    # Seed with every active SDR, not just ones stats has a row for — an
    # active SDR with zero calls AND zero form fills that day should still
    # get a card (all zeros), the same fix already applied to the
    # Commission dashboard for the same reason.
    stats_by_name = {s.sdr_name: s for s in stats}
    active_names = {sdr.full_name for sdr in db.query(Sdr).all() if sdr.active}
    all_names = (active_names | set(stats_by_name.keys())) - EXCLUDED_SDR_NAMES

    sdrs = []
    for name in all_names:
        s = stats_by_name.get(name)
        sdr_deltas = (s.deltas or {}) if s else {}
        calls = s.calls if s else 0
        q_today = quotes_today.get(name, 0)
        q_prev = quotes_prev.get(name, 0)
        smp_today = samples_today.get(name, 0)
        smp_prev = samples_prev.get(name, 0)
        convert_today = _convert_pct(smp_today, calls)
        prev_stat = None
        if prev_date:
            prev_stat = db.query(SdrDailyStat).filter(
                SdrDailyStat.report_date == prev_date, SdrDailyStat.sdr_name == name
            ).first()
        convert_prev = _convert_pct(smp_prev, prev_stat.calls) if prev_stat else None
        sdrs.append({
            "name": name,
            "calls": calls,
            "mix": {
                "connected": s.connected_pct if s else 0.0,
                "voicemail": s.voicemail_pct if s else 0.0,
                "other": s.other_pct if s else 0.0,
                "connectedDelta": sdr_deltas.get("connected"),
                "voicemailDelta": sdr_deltas.get("voicemail"),
                "otherDelta": sdr_deltas.get("other"),
            },
            "samples": {"v": smp_today, "delta": _delta(smp_today, smp_prev)},
            "convert": {"v": convert_today, "delta": _delta_pp(convert_today, convert_prev)},
            "quotes": {"v": q_today, "delta": _delta(q_today, q_prev)},
            "formFills": {
                "v": form_fills_today.get(name, 0),
                "delta": _delta(form_fills_today.get(name, 0), form_fills_prev.get(name, 0)),
            },
            "clock": {
                "timeLabel": _format_span_label(s.span_start, s.span_end),
                "start": s.span_start, "end": s.span_end,
                "idle": _idle_indices(s.active_chunks),
                "activeHrs": s.active_hrs, "idleHrs": s.idle_hrs,
            } if s and s.span_start is not None else None,
        })
    sdrs.sort(key=lambda r: (-r["calls"], r["name"]))

    return {
        "note": (
            "Today's calls/connect/active hours will populate tonight once the Aircall pipeline "
            "runs — samples, quotes, and form fills below are already live."
        ) if not summary else None,
        "team": {
            "calls": team_calls, "connect": summary.connect_pct if summary else 0.0, "convert": team_convert_today,
            "samples": samples_total_today, "activeHrs": summary.active_hrs if summary else 0.0, "quotes": quotes_total_today,
            "formFills": form_fills_total_today,
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
    form_fills_by_sdr, form_fills_total = _form_fills_by_sdr(db, start, end)
    team_convert = _convert_pct(samples_total, team_calls)

    by_sdr: Dict[str, List[SdrDailyStat]] = defaultdict(list)
    for s in stats:
        by_sdr[s.sdr_name].append(s)

    # Seed with every active SDR, not just ones with a calls row in range —
    # see the matching comment in get_daily_report.
    active_names = {sdr.full_name for sdr in db.query(Sdr).all() if sdr.active}
    all_names = (active_names | set(by_sdr.keys())) - EXCLUDED_SDR_NAMES

    sdr_rows = []
    for name in all_names:
        rows = by_sdr.get(name, [])
        calls = sum(r.calls for r in rows)
        connected = _weighted_avg([(r.connected_pct, r.calls) for r in rows])
        voicemail = _weighted_avg([(r.voicemail_pct, r.calls) for r in rows])
        other = max(0.0, 100 - connected - voicemail)
        sdr_samples = samples_by_sdr.get(name, 0)
        convert = _convert_pct(sdr_samples, calls)
        active_hrs = (sum(r.active_hrs for r in rows) / len(rows)) if rows else 0.0
        idle_hrs = (sum(r.idle_hrs for r in rows) / len(rows)) if rows else 0.0
        sdr_rows.append({
            "name": name, "calls": calls,
            "mix": {"connected": round(connected, 1), "voicemail": round(voicemail, 1), "other": round(other, 1)},
            "samples": {"v": sdr_samples, "delta": None},
            "convert": {"v": convert, "delta": None},
            "quotes": {"v": quotes_by_sdr.get(name, 0), "delta": None},
            "formFills": {"v": form_fills_by_sdr.get(name, 0), "delta": None},
            "span8": {"active": round(active_hrs, 1), "idle": round(idle_hrs, 1)},
        })
    sdr_rows.sort(key=lambda r: (-r["calls"], r["name"]))

    prior_start, prior_end = _prior_range(start, end)
    prior_summaries = db.query(DailySummary).filter(DailySummary.report_date.between(prior_start, prior_end)).all()
    _, prior_quotes_total = _quotes_by_sdr(db, prior_start, prior_end)
    _, prior_samples_total = _samples_by_sdr(db, prior_start, prior_end)
    _, prior_form_fills_total = _form_fills_by_sdr(db, prior_start, prior_end)
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
        "formFills": _delta(form_fills_total, prior_form_fills_total) or {"dir": "flat", "pct": 0},
    }

    return {
        "team": {
            "calls": team_calls, "connect": round(team_connect, 1), "convert": team_convert,
            "samples": samples_total, "activeHrs": round(team_active_hrs, 1), "quotes": quotes_total,
            "formFills": form_fills_total,
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
