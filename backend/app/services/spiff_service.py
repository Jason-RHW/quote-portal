import json
import os
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional

from openai import OpenAI
from sqlalchemy.orm import Session

from app.models.db_models import CommissionSpiffRule, Quote, SampleRequest, Sdr, SdrDailyStat, gen_id


EXCLUDED_COMMISSION_SDRS = {"Jason Rui", "Henry Park", "Angel Sun"}
INVALID_COMMISSION_SDR_NAMES = {"", "no", "none", "n/a", "na", "unknown", "test"}


def _campaign_payload(row: CommissionSpiffRule) -> Dict[str, Any]:
    return {
        "id": row.id,
        "month": row.month,
        "prompt": row.prompt or "",
        "rule": row.rule_json or {},
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def list_campaigns(db: Session, month: str) -> List[Dict[str, Any]]:
    rows = (
        db.query(CommissionSpiffRule)
        .filter(CommissionSpiffRule.month == month, CommissionSpiffRule.deleted_at.is_(None))
        .order_by(CommissionSpiffRule.created_at.asc(), CommissionSpiffRule.id.asc())
        .all()
    )
    return [_campaign_payload(row) for row in rows]


def create_campaigns(db: Session, month: str, campaigns: List[Dict[str, Any]], created_by: Optional[str] = None) -> List[Dict[str, Any]]:
    for campaign in campaigns:
        db.add(
            CommissionSpiffRule(
                id=gen_id(),
                month=month,
                prompt=campaign.get("prompt") or "",
                rule_json=campaign.get("rule") or {},
                created_by=created_by,
            )
        )
    db.commit()
    return list_campaigns(db, month)


def delete_campaign(db: Session, campaign_id: str) -> Optional[str]:
    row = (
        db.query(CommissionSpiffRule)
        .filter(CommissionSpiffRule.id == campaign_id, CommissionSpiffRule.deleted_at.is_(None))
        .first()
    )
    if not row:
        return None
    row.deleted_at = datetime.utcnow()
    db.commit()
    return row.month


def clear_campaigns(db: Session, month: str) -> None:
    rows = (
        db.query(CommissionSpiffRule)
        .filter(CommissionSpiffRule.month == month, CommissionSpiffRule.deleted_at.is_(None))
        .all()
    )
    now = datetime.utcnow()
    for row in rows:
        row.deleted_at = now
    db.commit()


RULE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string"},
        "rule_type": {
            "type": "string",
            "enum": ["flat_rate", "threshold_bonus", "first_to_target", "first_to_targets", "leaderboard", "daily_leader_bonus", "flat_plus_threshold"],
        },
        "start_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
        "end_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
        "date_field": {"type": "string", "enum": ["created_at", "requested_date", "sent_date", "delivered_date"]},
        "entity_type": {"type": "string", "enum": ["sample", "quote", "both"]},
        "threshold_entity_type": {"type": "string", "enum": ["sample", "quote", "both"]},
        "qualification_scope": {"type": "string", "enum": ["individual", "team"]},
        "active_filter": {"type": "string", "enum": ["none", "calls"]},
        "eligible_statuses": {
            "type": "array",
            "items": {"type": "string", "enum": ["requested", "sent", "delivered", "on_hold", "rejected"]},
        },
        "amount_per_sample": {"type": ["number", "null"]},
        "amount_per_quote": {"type": ["number", "null"]},
        "quote_value_min": {"type": ["number", "null"]},
        "target_count": {"type": ["integer", "null"]},
        "bonus_amount": {"type": ["number", "null"]},
        "first_to_targets": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "target_count": {"type": "integer"},
                    "bonus_amount": {"type": "number"},
                    "max_winners": {"type": ["integer", "null"]},
                },
                "required": ["target_count", "bonus_amount", "max_winners"],
            },
        },
        "max_winners": {"type": ["integer", "null"]},
        "leaderboard_prizes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "rank": {"type": "integer"},
                    "amount": {"type": "number"},
                },
                "required": ["rank", "amount"],
            },
        },
        "included_sdr_names": {"type": "array", "items": {"type": "string"}},
        "tie_behavior": {"type": "string"},
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "missing_info": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "name", "rule_type", "start_date", "end_date", "date_field", "entity_type", "threshold_entity_type", "qualification_scope", "active_filter", "eligible_statuses",
        "amount_per_sample", "amount_per_quote", "quote_value_min", "target_count", "bonus_amount", "first_to_targets", "max_winners",
        "leaderboard_prizes", "included_sdr_names", "tie_behavior", "assumptions", "missing_info",
    ],
}


SPIFF_INSTRUCTIONS = """You translate manager-written SPIFF descriptions into one deterministic rule JSON.
Do not calculate payouts. Extract only the rule.

Supported rule types:
- flat_rate: amount_per_sample is paid for every eligible sample; amount_per_quote is paid for every eligible quote.
- threshold_bonus: each SDR gets bonus_amount if the qualifying threshold is reached.
- first_to_target: first SDR to reach target_count gets bonus_amount. Use max_winners=1 unless stated otherwise.
- first_to_targets: multiple first-to-target milestones, such as "first to 25 gets $75, first to 30 gets $100".
  Fill first_to_targets with one object per milestone.
- leaderboard: rank-based prizes; fill leaderboard_prizes.
- daily_leader_bonus: for each day in the date range, the SDR with the most eligible samples that day gets bonus_amount.
  Use this for rules like "each day, the top SDR sending out the most samples gets $X"; this is not a monthly total leaderboard.
- flat_plus_threshold: amount_per_sample and/or amount_per_quote plus bonus_amount when target_count is reached.

Defaults when omitted:
- date_field: created_at.
- entity_type: sample, unless the description mentions quotes; both if it mentions samples and quotes.
- threshold_entity_type: what the target_count is counting. For "25 samples $75 and $10 per quote",
  use entity_type=both and threshold_entity_type=sample.
- qualification_scope: individual unless the rule says the team/all SDRs/total records need to hit the threshold.
  For example, "$10 for each SDR if all SDRs get total 8 samples" is qualification_scope=team.
- active_filter: none unless the manager says active SDRs means people who had calls/worked during the period; then use calls.
- amount_per_quote: only fill when the rule explicitly gives a quote rate. For "$3 per sample and $10 per quote",
  use amount_per_sample=3 and amount_per_quote=10.
- quote_value_min: fill for rules like "$10 per quote for quote value > $200".
- eligible_statuses: requested, sent, delivered, on_hold.
- included_sdr_names: [] means all SDRs with eligible samples.
- tie_behavior: earliest qualifying sample timestamp wins for first_to_target; equal rank for leaderboard.
  For daily_leader_bonus, set tie_behavior to one of:
  earliest_last_activity: tied daily leaders are broken by earliest last sample timestamp, then SDR name.
  rollover: if a day ties, do not pay that day yet; carry the unpaid bonus into the next day and compare total samples across the accumulated tied window until one SDR clearly leads.

SPIFF rules replace the normal commission for the records they cover. For example, "$3 per sample today" means
the payout is exactly $3 per sample, not the normal $1 plus $3.

If dates, money, target counts, SDR eligibility, record type, or status/date-field rules are ambiguous, choose the most reasonable value
and add a concise note to assumptions or missing_info. Return JSON only."""


def interpret_spiff_prompt(prompt: str) -> Dict[str, Any]:
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    client = OpenAI()
    model = os.getenv("OPENAI_SPIFF_MODEL", "gpt-5.6-luna")
    dated_prompt = (
        f"Today is {date.today().isoformat()}. "
        "If the SPIFF description gives a month/day without a year, infer the current year. "
        f"SPIFF description: {prompt}"
    )
    response = client.responses.create(
        model=model,
        instructions=SPIFF_INSTRUCTIONS,
        input=dated_prompt,
        text={
            "format": {
                "type": "json_schema",
                "name": "spiff_rule",
                "schema": RULE_SCHEMA,
                "strict": True,
            },
            "verbosity": "low",
        },
        reasoning={"effort": "low"},
        max_output_tokens=1600,
    )
    rule = json.loads(response.output_text)
    lower_prompt = prompt.lower()
    if (
        ("each day" in lower_prompt or "per day" in lower_prompt or "daily" in lower_prompt)
        and ("top" in lower_prompt or "most" in lower_prompt or "leader" in lower_prompt)
        and "sample" in lower_prompt
    ):
        inferred_bonus = rule.get("bonus_amount") or rule.get("amount_per_sample") or rule.get("amount_per_quote")
        rule["rule_type"] = "daily_leader_bonus"
        rule["entity_type"] = "sample"
        rule["threshold_entity_type"] = "sample"
        rule["qualification_scope"] = "individual"
        rule["amount_per_sample"] = None
        rule["amount_per_quote"] = None
        rule["target_count"] = None
        rule["bonus_amount"] = inferred_bonus
        rule["leaderboard_prizes"] = []
        rule["max_winners"] = int(rule.get("max_winners") or 1)
        if "roll" in lower_prompt or "carry" in lower_prompt:
            rule["tie_behavior"] = "rollover"
        elif rule.get("tie_behavior") not in {"rollover", "earliest_last_activity", "split", "no_payout"}:
            rule["tie_behavior"] = "earliest_last_activity"
        if not rule.get("assumptions"):
            rule["assumptions"] = []
        rule["assumptions"].append("Interpreted as a daily SPIFF: each date has its own top-SDR winner by eligible sample count.")
    if (
        rule.get("rule_type") == "threshold_bonus"
        and ("total" in lower_prompt or "team" in lower_prompt or "all sdr" in lower_prompt)
        and ("each sdr" in lower_prompt or "all sdr" in lower_prompt)
    ):
        rule["qualification_scope"] = "team"
        if not rule.get("assumptions"):
            rule["assumptions"] = []
        rule["assumptions"].append("Interpreted as a team threshold: once the team reaches the target, each active SDR receives the bonus.")
    if "have calls" in lower_prompt or "has calls" in lower_prompt or "meaning have calls" in lower_prompt:
        rule["active_filter"] = "calls"
    if "quote value" in lower_prompt and "200" in lower_prompt and not rule.get("quote_value_min"):
        rule["quote_value_min"] = 200
    if rule.get("target_count") and "sample" in lower_prompt:
        rule["threshold_entity_type"] = "sample"
    elif rule.get("target_count") and "quote" in lower_prompt and "sample" not in lower_prompt:
        rule["threshold_entity_type"] = "quote"
    return rule


def _date_value(req: Any, date_field: str) -> Optional[date]:
    value = getattr(req, date_field, None)
    if isinstance(value, datetime):
        return value.date()
    return value


def _timestamp_value(req: Any, date_field: str) -> datetime:
    value = getattr(req, date_field, None)
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    return datetime.max


def _parse_date(value: Optional[str]) -> Optional[date]:
    return date.fromisoformat(value) if value else None


def _sample_date_field(rule: Dict[str, Any]) -> str:
    field = rule.get("date_field") or "created_at"
    return "created_at" if field == "date_requested" else field


def _name_included(full_name: str, included_names: set[str]) -> bool:
    if full_name in EXCLUDED_COMMISSION_SDRS:
        return False
    if not included_names:
        return True
    full = full_name.strip().lower()
    return any(name.lower() == full or name.lower() in full for name in included_names)


def _is_commission_sdr_name(name: Optional[str]) -> bool:
    normalized = (name or "").strip()
    return bool(normalized) and normalized not in EXCLUDED_COMMISSION_SDRS and normalized.lower() not in INVALID_COMMISSION_SDR_NAMES


def _known_sdr_names(db: Session) -> Dict[str, str]:
    return {sdr.full_name.strip().lower(): sdr.full_name for sdr in db.query(Sdr).all() if _is_commission_sdr_name(sdr.full_name)}


def _created_by_date(sdr: Sdr, as_of: Optional[date]) -> bool:
    if not as_of:
        return True
    created_at = sdr.created_at
    if isinstance(created_at, datetime):
        return created_at.date() <= as_of
    return True


def _eligible_samples(db: Session, rule: Dict[str, Any]) -> tuple[Dict[str, Sdr], Dict[str, List[SampleRequest]]]:
    start = _parse_date(rule.get("start_date"))
    end = _parse_date(rule.get("end_date"))
    date_field = _sample_date_field(rule)
    eligible_statuses = set(rule.get("eligible_statuses") or ["requested", "sent", "delivered", "on_hold"])
    included_names = {name.strip() for name in rule.get("included_sdr_names", []) if name.strip()}
    sdrs_by_id = {
        s.id: s
        for s in db.query(Sdr).all()
        if _is_commission_sdr_name(s.full_name)
    }

    rows = db.query(SampleRequest).filter(SampleRequest.archived_at.is_(None)).all()
    by_sdr: Dict[str, List[SampleRequest]] = defaultdict(list)
    for req in rows:
        sdr = sdrs_by_id.get(req.sdr_id)
        if not sdr:
            continue
        if not _name_included(sdr.full_name, included_names):
            continue
        status = req.status.value if req.status else ""
        if status not in eligible_statuses:
            continue
        d = _date_value(req, date_field)
        if not d:
            continue
        if start and d < start:
            continue
        if end and d > end:
            continue
        by_sdr[sdr.id].append(req)

    for sample_rows in by_sdr.values():
        sample_rows.sort(key=lambda r: (_timestamp_value(r, date_field), r.id))
    return sdrs_by_id, by_sdr


def _sample_payload(
    req: SampleRequest,
    date_field: str,
    amount: float = 0,
    base_amount: float = 0,
    spiff_applied: bool = False,
) -> Dict[str, Any]:
    d = _date_value(req, date_field)
    return {
        "id": str(req.id),
        "business_name": req.business_name,
        "status": req.status.value if req.status else None,
        "date": d.isoformat() if d else None,
        "amount": round(amount, 2),
        "base_amount": round(base_amount, 2),
        "spiff_delta": round(amount - base_amount, 2),
        "spiff_applied": spiff_applied,
    }


def _quote_payload(
    quote: Quote,
    amount: float = 0,
    base_amount: float = 0,
    spiff_applied: bool = False,
) -> Dict[str, Any]:
    d = quote.date_requested.date() if quote.date_requested else None
    return {
        "id": str(quote.id),
        "business_name": quote.business_name,
        "status": quote.status.value if quote.status else None,
        "date": d.isoformat() if d else None,
        "amount": round(amount, 2),
        "base_amount": round(base_amount, 2),
        "spiff_delta": round(amount - base_amount, 2),
        "spiff_applied": spiff_applied,
    }


def _eligible_quotes(db: Session, rule: Dict[str, Any]) -> Dict[str, List[Quote]]:
    start = _parse_date(rule.get("start_date"))
    end = _parse_date(rule.get("end_date"))
    included_names = {name.strip() for name in rule.get("included_sdr_names", []) if name.strip()}
    quote_value_min = rule.get("quote_value_min")
    known_sdr_names = _known_sdr_names(db)
    by_sdr: Dict[str, List[Quote]] = defaultdict(list)
    for quote in db.query(Quote).all():
        if not quote.date_requested:
            continue
        d = quote.date_requested.date()
        if start and d < start:
            continue
        if end and d > end:
            continue
        if quote_value_min is not None and float(quote.quote_value or 0) <= float(quote_value_min):
            continue
        raw_sdr_name = ((quote.extra or {}).get("associated_sdr") or quote.requested_by or "").strip()
        sdr_name = known_sdr_names.get(raw_sdr_name.lower())
        if not sdr_name:
            continue
        if not _name_included(sdr_name, included_names):
            continue
        by_sdr[sdr_name].append(quote)
    for quote_rows in by_sdr.values():
        quote_rows.sort(key=lambda q: (q.date_requested or datetime.max, q.id))
    return by_sdr


def _active_sdrs_as_of(db: Session, as_of: Optional[date]) -> List[Sdr]:
    rows = [
        sdr for sdr in db.query(Sdr).all()
        if _is_commission_sdr_name(sdr.full_name)
    ]
    if not as_of:
        return rows
    active = []
    for sdr in rows:
        created_at = sdr.created_at
        if isinstance(created_at, datetime) and created_at.date() > as_of:
            continue
        active.append(sdr)
    return active


def _working_sdr_names(db: Session, start: Optional[date], end: Optional[date]) -> set[str]:
    if not start or not end:
        return set()
    rows = (
        db.query(SdrDailyStat)
        .filter(SdrDailyStat.report_date >= start)
        .filter(SdrDailyStat.report_date <= end)
        .filter(SdrDailyStat.calls > 0)
        .all()
    )
    return {row.sdr_name for row in rows}


def _bonus_eligible_sdrs(db: Session, rule: Dict[str, Any]) -> List[Sdr]:
    start = _parse_date(rule.get("start_date"))
    end = _parse_date(rule.get("end_date")) or start
    if rule.get("active_filter") == "calls":
        working_names = _working_sdr_names(db, start, end)
        return [
            sdr for sdr in db.query(Sdr).all()
            if sdr.full_name in working_names
            and _is_commission_sdr_name(sdr.full_name)
        ]
    return _active_sdrs_as_of(db, end or start)


def _base_commission_report(db: Session, start: date, end: date, name: str) -> Dict[str, Any]:
    rule = {
        "name": name,
        "rule_type": "base_commission",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "date_field": "created_at",
        "entity_type": "both",
        "threshold_entity_type": "sample",
        "qualification_scope": "individual",
        "eligible_statuses": ["requested", "sent", "delivered", "on_hold"],
        "amount_per_sample": 1,
        "amount_per_quote": 3,
        "target_count": None,
        "bonus_amount": None,
        "max_winners": None,
        "leaderboard_prizes": [],
        "included_sdr_names": [],
        "tie_behavior": "N/A",
        "assumptions": ["Default commission is $1 per sample and $3 per quote."],
        "missing_info": [],
    }
    sample_rule = {**rule, "start_date": start.isoformat(), "end_date": end.isoformat()}
    sdrs_by_id, samples_by_sdr = _eligible_samples(db, sample_rule)
    quotes_by_sdr = _eligible_quotes(db, rule)
    names = set(quotes_by_sdr)
    names.update(sdrs_by_id[sdr_id].full_name for sdr_id in samples_by_sdr)

    results = []
    for name in sorted(names):
        sample_rows = []
        for sdr_id, rows in samples_by_sdr.items():
            if sdrs_by_id[sdr_id].full_name == name:
                sample_rows = rows
                break
        quote_rows = quotes_by_sdr.get(name, [])
        sample_count = len(sample_rows)
        quote_count = len(quote_rows)
        sample_payloads = [_sample_payload(req, "created_at", 1, 1, False) for req in sample_rows]
        quote_payloads = [_quote_payload(q, 3, 3, False) for q in quote_rows]
        sample_payout = sum(item["amount"] for item in sample_payloads)
        quote_payout = sum(item["amount"] for item in quote_payloads)
        payout = sample_payout + quote_payout
        results.append({
            "sdr_id": name,
            "sdr_name": name,
            "eligible_sample_count": sample_count,
            "eligible_quote_count": quote_count,
            "eligible_unit_count": sample_count + quote_count,
            "sample_rate": 1,
            "quote_rate": 3,
            "base_sample_payout": round(sample_count, 2),
            "base_quote_payout": round(quote_count * 3, 2),
            "spiff_sample_delta": 0,
            "spiff_quote_delta": 0,
            "sample_payout": round(sample_payout, 2),
            "quote_payout": round(quote_payout, 2),
            "spiff_payout": 0,
            "payout_amount": round(payout, 2),
            "reason": f"{sample_count} sample(s) x $1.00 + {quote_count} quote(s) x $3.00.",
            "reached_at": None,
            "samples": sample_payloads,
            "quotes": quote_payloads,
        })

    results.sort(key=lambda r: (-r["payout_amount"], -r["eligible_unit_count"], r["sdr_name"]))
    return {
        "rule": rule,
        "results": results,
        "totals": {
            "sdr_count": len(results),
            "sample_count": sum(r["eligible_sample_count"] for r in results),
            "quote_count": sum(r["eligible_quote_count"] for r in results),
            "unit_count": sum(r["eligible_unit_count"] for r in results),
            "payout_amount": round(sum(r["payout_amount"] for r in results), 2),
        },
    }


def _month_bounds(month: str) -> tuple[date, date]:
    month_start = date.fromisoformat(f"{month}-01")
    next_month = (
        date(month_start.year + 1, 1, 1)
        if month_start.month == 12
        else date(month_start.year, month_start.month + 1, 1)
    )
    return month_start, next_month - timedelta(days=1)


def _date_in_rule(d: Optional[date], rule: Dict[str, Any]) -> bool:
    if not d:
        return False
    start = _parse_date(rule.get("start_date"))
    end = _parse_date(rule.get("end_date"))
    if start and d < start:
        return False
    if end and d > end:
        return False
    return True


def _rule_rates(rule: Dict[str, Any]) -> tuple[float, float]:
    entity_type = rule.get("entity_type") or "sample"
    sample_rate = float(rule.get("amount_per_sample") or 0)
    quote_rate = float(rule.get("amount_per_quote") or 0)
    if entity_type == "quote" and not quote_rate and sample_rate:
        quote_rate = sample_rate
    if entity_type == "sample" and not sample_rate and quote_rate:
        sample_rate = quote_rate
    return sample_rate, quote_rate


def _count_for_entity(samples: List[Any], quotes: List[Any], entity_type: str) -> int:
    if entity_type == "quote":
        return len(quotes)
    if entity_type == "both":
        return len(samples) + len(quotes)
    return len(samples)


def apply_rule_to_month(db: Session, month: str, rule: Dict[str, Any]) -> Dict[str, Any]:
    return apply_rules_to_month(db, month, [rule])


def apply_rules_to_month(db: Session, month: str, rules: List[Dict[str, Any]]) -> Dict[str, Any]:
    month_start, month_end = _month_bounds(month)
    month_rule = {
        "start_date": month_start.isoformat(),
        "end_date": month_end.isoformat(),
        "date_field": "created_at",
        "eligible_statuses": ["requested", "sent", "delivered", "on_hold"],
    }
    sdrs_by_id, samples_by_sdr = _eligible_samples(db, month_rule)
    quotes_by_sdr = _eligible_quotes(db, month_rule)
    scoped_previews = [calculate_preview(db, rule) for rule in rules]
    spiff_bonus_by_name: Dict[str, float] = defaultdict(float)
    spiff_bonus_details_by_name: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for idx, preview in enumerate(scoped_previews):
        rule_name = (rules[idx] or {}).get("name") or f"SPIFF {idx + 1}"
        for row in preview["results"]:
            if row["sdr_name"] in EXCLUDED_COMMISSION_SDRS:
                continue
            amount = float(row.get("spiff_payout") or 0)
            spiff_bonus_by_name[row["sdr_name"]] += amount
            if amount:
                daily_wins = row.get("daily_wins") or []
                if daily_wins:
                    for win in daily_wins:
                        spiff_bonus_details_by_name[row["sdr_name"]].append({
                            "name": f"{rule_name} ({win.get('date')})",
                            "amount": round(float(win.get("amount") or 0), 2),
                        })
                else:
                    spiff_bonus_details_by_name[row["sdr_name"]].append({
                        "name": rule_name,
                        "amount": round(amount, 2),
                    })

    names = set(quotes_by_sdr)
    names.update(sdrs_by_id[sdr_id].full_name for sdr_id in samples_by_sdr)
    for rule in rules:
        if rule.get("rule_type") == "threshold_bonus" and (rule.get("qualification_scope") or "individual") == "team":
            names.update(sdr.full_name for sdr in _bonus_eligible_sdrs(db, rule))
    results = []
    for sdr_name in sorted(names):
        sample_rows = []
        for sdr_id, rows in samples_by_sdr.items():
            if sdrs_by_id[sdr_id].full_name == sdr_name:
                sample_rows = rows
                break
        quote_rows = quotes_by_sdr.get(sdr_name, [])

        sample_payloads = []
        for req in sample_rows:
            base_amount = 1.0
            amount = base_amount
            campaigns = []
            status = req.status.value if req.status else ""
            for rule in rules:
                entity_type = rule.get("entity_type") or "sample"
                sample_rate, _ = _rule_rates(rule)
                spiff_statuses = set(rule.get("eligible_statuses") or ["requested", "sent", "delivered", "on_hold"])
                included_names = {name.strip() for name in rule.get("included_sdr_names", []) if name.strip()}
                if not _name_included(sdr_name, included_names):
                    continue
                if rule.get("active_filter") == "calls":
                    working_names = _working_sdr_names(db, _parse_date(rule.get("start_date")), _parse_date(rule.get("end_date")))
                    if sdr_name not in working_names:
                        continue
                d = _date_value(req, _sample_date_field(rule))
                spiff_applies = (
                    rule.get("rule_type") in {"flat_rate", "flat_plus_threshold"}
                    and entity_type in {"sample", "both"}
                    and rule.get("amount_per_sample") is not None
                    and status in spiff_statuses
                    and _date_in_rule(d, rule)
                )
                if spiff_applies:
                    delta = sample_rate - base_amount
                    amount += delta
                    campaigns.append({
                        "name": rule.get("name") or "SPIFF",
                        "start_date": rule.get("start_date"),
                        "end_date": rule.get("end_date"),
                        "delta": round(delta, 2),
                        "rate": round(sample_rate, 2),
                    })
            payload = _sample_payload(req, "created_at", amount, base_amount, bool(campaigns))
            payload["spiff_campaigns"] = campaigns
            sample_payloads.append(payload)

        quote_payloads = []
        for quote in quote_rows:
            base_amount = 3.0
            amount = base_amount
            campaigns = []
            d = quote.date_requested.date() if quote.date_requested else None
            for rule in rules:
                entity_type = rule.get("entity_type") or "sample"
                _, quote_rate = _rule_rates(rule)
                included_names = {name.strip() for name in rule.get("included_sdr_names", []) if name.strip()}
                if not _name_included(sdr_name, included_names):
                    continue
                if rule.get("active_filter") == "calls":
                    working_names = _working_sdr_names(db, _parse_date(rule.get("start_date")), _parse_date(rule.get("end_date")))
                    if sdr_name not in working_names:
                        continue
                quote_value_min = rule.get("quote_value_min")
                spiff_applies = (
                    rule.get("rule_type") in {"flat_rate", "flat_plus_threshold"}
                    and entity_type in {"quote", "both"}
                    and rule.get("amount_per_quote") is not None
                    and _date_in_rule(d, rule)
                    and (quote_value_min is None or float(quote.quote_value or 0) > float(quote_value_min))
                )
                if spiff_applies:
                    delta = quote_rate - base_amount
                    amount += delta
                    campaigns.append({
                        "name": rule.get("name") or "SPIFF",
                        "start_date": rule.get("start_date"),
                        "end_date": rule.get("end_date"),
                        "delta": round(delta, 2),
                        "rate": round(quote_rate, 2),
                    })
            payload = _quote_payload(quote, amount, base_amount, bool(campaigns))
            payload["spiff_campaigns"] = campaigns
            quote_payloads.append(payload)

        sample_count = len(sample_payloads)
        quote_count = len(quote_payloads)
        base_sample_payout = sum(item["base_amount"] for item in sample_payloads)
        base_quote_payout = sum(item["base_amount"] for item in quote_payloads)
        sample_payout = sum(item["amount"] for item in sample_payloads)
        quote_payout = sum(item["amount"] for item in quote_payloads)
        spiff_sample_delta = sample_payout - base_sample_payout
        spiff_quote_delta = quote_payout - base_quote_payout
        spiff_bonus = spiff_bonus_by_name.get(sdr_name, 0)
        spiff_bonus_details = spiff_bonus_details_by_name.get(sdr_name, [])
        payout = sample_payout + quote_payout + spiff_bonus
        visible_rules = [rule for rule in rules if rule]
        results.append({
            "sdr_id": sdr_name,
            "sdr_name": sdr_name,
            "eligible_sample_count": sample_count,
            "eligible_quote_count": quote_count,
            "eligible_unit_count": sample_count + quote_count,
            "sample_rate": 1,
            "quote_rate": 3,
            "base_sample_payout": round(base_sample_payout, 2),
            "base_quote_payout": round(base_quote_payout, 2),
            "spiff_sample_delta": round(spiff_sample_delta, 2),
            "spiff_quote_delta": round(spiff_quote_delta, 2),
            "sample_payout": round(sample_payout, 2),
            "quote_payout": round(quote_payout, 2),
            "spiff_payout": round(spiff_bonus, 2),
            "spiff_bonus_details": spiff_bonus_details,
            "payout_amount": round(payout, 2),
            "reason": (
                f"Base: {sample_count} sample(s) x $1.00 + {quote_count} quote(s) x $3.00. "
                f"SPIFF adjustment: samples {'+' if spiff_sample_delta >= 0 else '-'}${abs(spiff_sample_delta):,.2f}, "
                f"quotes {'+' if spiff_quote_delta >= 0 else '-'}${abs(spiff_quote_delta):,.2f}"
                + (f", bonus +${spiff_bonus:,.2f}." if spiff_bonus else ".")
            ),
            "reached_at": None,
            "spiff_campaign_count": len(visible_rules),
            "samples": sample_payloads,
            "quotes": quote_payloads,
        })

    results.sort(key=lambda r: (-r["payout_amount"], -r["eligible_unit_count"], r["sdr_name"]))
    return {
        "rule": {
            "name": f"{month} SDR commission with SPIFF",
            "rule_type": "applied_spiff",
            "start_date": month_start.isoformat(),
            "end_date": month_end.isoformat(),
            "entity_type": "both",
            "applied_spiff_rules": rules,
        },
        "results": results,
        "totals": {
            "sdr_count": len(results),
            "sample_count": sum(r["eligible_sample_count"] for r in results),
            "quote_count": sum(r["eligible_quote_count"] for r in results),
            "unit_count": sum(r["eligible_unit_count"] for r in results),
            "payout_amount": round(sum(r["payout_amount"] for r in results), 2),
            "base_payout_amount": round(sum(r["base_sample_payout"] + r["base_quote_payout"] for r in results), 2),
            "spiff_delta_amount": round(sum(r["spiff_sample_delta"] + r["spiff_quote_delta"] + r["spiff_payout"] for r in results), 2),
        },
    }


def calculate_preview(db: Session, rule: Dict[str, Any]) -> Dict[str, Any]:
    entity_type = rule.get("entity_type") or "sample"
    threshold_entity_type = rule.get("threshold_entity_type") or entity_type
    qualification_scope = rule.get("qualification_scope") or "individual"
    date_field = _sample_date_field(rule)
    sdrs_by_id, sample_rows_by_id = _eligible_samples(db, rule) if entity_type in {"sample", "both"} else ({}, {})
    quote_rows_by_name = _eligible_quotes(db, rule) if entity_type in {"quote", "both"} else {}
    rule_type = rule.get("rule_type")
    amount_per_sample = float(rule.get("amount_per_sample") or 0)
    amount_per_quote = float(rule.get("amount_per_quote") or 0)
    if entity_type == "quote" and not amount_per_quote and amount_per_sample:
        amount_per_quote = amount_per_sample
    if entity_type == "sample" and not amount_per_sample and amount_per_quote:
        amount_per_sample = amount_per_quote
    target_count = int(rule.get("target_count") or 0)
    bonus_amount = float(rule.get("bonus_amount") or 0)
    max_winners = int(rule.get("max_winners") or 1)
    results = []
    by_sdr: Dict[str, Dict[str, Any]] = {}
    unit_label = "quote" if entity_type == "quote" else "record" if entity_type == "both" else "sample"

    for sdr_id, sample_rows in sample_rows_by_id.items():
        sdr = sdrs_by_id[sdr_id]
        by_sdr.setdefault(sdr.full_name, {"sdr_id": sdr_id, "samples": [], "quotes": []})["samples"].extend(sample_rows)
    for sdr_name, quote_rows in quote_rows_by_name.items():
        by_sdr.setdefault(sdr_name, {"sdr_id": sdr_name, "samples": [], "quotes": []})["quotes"].extend(quote_rows)
    if rule_type == "threshold_bonus" and qualification_scope == "team":
        for sdr in _bonus_eligible_sdrs(db, rule):
            by_sdr.setdefault(sdr.full_name, {"sdr_id": sdr.id, "samples": [], "quotes": []})
    if rule_type == "threshold_bonus" and qualification_scope == "individual" and int(rule.get("target_count") or 0) == 0:
        included_names = {name.strip() for name in rule.get("included_sdr_names", []) if name.strip()}
        active_as_of = _parse_date(rule.get("end_date")) or _parse_date(rule.get("start_date"))
        for sdr in _active_sdrs_as_of(db, active_as_of):
            if _name_included(sdr.full_name, included_names):
                by_sdr.setdefault(sdr.full_name, {"sdr_id": sdr.id, "samples": [], "quotes": []})

    team_count = 0
    if rule_type == "threshold_bonus" and qualification_scope == "team":
        for grouped in by_sdr.values():
            team_count += _count_for_entity(grouped["samples"], grouped["quotes"], threshold_entity_type)

    for sdr_name, grouped in by_sdr.items():
        samples = grouped["samples"]
        quotes = grouped["quotes"]
        count = len(quotes) if entity_type == "quote" else len(samples) + (len(quotes) if entity_type == "both" else 0)
        threshold_count = _count_for_entity(samples, quotes, threshold_entity_type)
        sample_count = len(samples)
        quote_count = len(quotes)
        sample_payout = 0.0
        quote_payout = 0.0
        spiff_payout = 0.0
        payout = 0.0
        reason = "No payout rule matched."
        reached_at = None
        milestones = []

        if rule_type == "flat_rate":
            sample_payout = sample_count * amount_per_sample if entity_type in {"sample", "both"} else 0
            quote_payout = quote_count * amount_per_quote if entity_type in {"quote", "both"} else 0
            payout = sample_payout + quote_payout
            if entity_type == "both":
                reason = f"{sample_count} sample(s) x ${amount_per_sample:,.2f} + {quote_count} quote(s) x ${amount_per_quote:,.2f}."
            else:
                rate = amount_per_quote if entity_type == "quote" else amount_per_sample
                reason = f"{count} eligible {unit_label}(s) x ${rate:,.2f}."
        elif rule_type == "threshold_bonus":
            qualifies = team_count >= target_count if qualification_scope == "team" else threshold_count >= target_count
            if qualifies:
                spiff_payout = bonus_amount
                payout = spiff_payout
                if qualification_scope == "team":
                    reason = f"Team reached {team_count}/{target_count} {threshold_entity_type} threshold; active SDR bonus applies."
                else:
                    reason = f"Reached {threshold_count}/{target_count} {threshold_entity_type} threshold."
            else:
                if qualification_scope == "team":
                    reason = f"Team reached {team_count}/{target_count} {threshold_entity_type}s; threshold not reached."
                else:
                    reason = f"{threshold_count}/{target_count} {threshold_entity_type}s; threshold not reached."
        elif rule_type == "flat_plus_threshold":
            sample_payout = sample_count * amount_per_sample if entity_type in {"sample", "both"} else 0
            quote_payout = quote_count * amount_per_quote if entity_type in {"quote", "both"} else 0
            payout = sample_payout + quote_payout
            reason = f"{sample_count} sample(s) x ${amount_per_sample:,.2f} + {quote_count} quote(s) x ${amount_per_quote:,.2f}"
            if threshold_count >= target_count:
                spiff_payout = bonus_amount
                payout += spiff_payout
                reason += f" + ${bonus_amount:,.2f} threshold bonus."
            else:
                reason += "; threshold bonus not reached."
        elif rule_type == "first_to_target":
            if count >= target_count:
                qualifying_events = []
                if entity_type in {"sample", "both"}:
                    qualifying_events.extend(_timestamp_value(sample, date_field) for sample in samples)
                if entity_type in {"quote", "both"}:
                    qualifying_events.extend(quote.date_requested for quote in quotes if quote.date_requested)
                qualifying_events.sort()
                reached_at = qualifying_events[target_count - 1]
                reason = f"Reached {target_count} {unit_label}s on {reached_at.date().isoformat()}."
            else:
                reason = f"{count}/{target_count} {unit_label}s; target not reached."
        elif rule_type == "first_to_targets":
            qualifying_events = []
            if entity_type in {"sample", "both"}:
                qualifying_events.extend(_timestamp_value(sample, date_field) for sample in samples)
            if entity_type in {"quote", "both"}:
                qualifying_events.extend(quote.date_requested for quote in quotes if quote.date_requested)
            qualifying_events.sort()
            for milestone in rule.get("first_to_targets", []):
                target = int(milestone.get("target_count") or 0)
                if target and len(qualifying_events) >= target:
                    milestones.append({
                        "target_count": target,
                        "bonus_amount": float(milestone.get("bonus_amount") or 0),
                        "max_winners": int(milestone.get("max_winners") or 1),
                        "reached_at": qualifying_events[target - 1].isoformat(),
                    })
            reason = f"Reached {len(milestones)} first-to-target milestone(s)."
        elif rule_type == "leaderboard":
            reason = f"{count} eligible {unit_label}(s) for leaderboard ranking."
        elif rule_type == "daily_leader_bonus":
            reason = f"{sample_count} eligible sample(s) across daily top-SDR contests."

        results.append({
            "sdr_id": grouped["sdr_id"],
            "sdr_name": sdr_name,
            "eligible_sample_count": len(samples),
            "eligible_quote_count": len(quotes),
            "eligible_unit_count": count,
            "sample_rate": amount_per_sample if entity_type in {"sample", "both"} else 0,
            "quote_rate": amount_per_quote if entity_type in {"quote", "both"} else 0,
            "base_sample_payout": 0,
            "base_quote_payout": 0,
            "spiff_sample_delta": 0,
            "spiff_quote_delta": 0,
            "sample_payout": round(sample_payout, 2),
            "quote_payout": round(quote_payout, 2),
            "spiff_payout": round(spiff_payout, 2),
            "payout_amount": round(payout, 2),
            "reason": reason,
            "reached_at": reached_at.isoformat() if reached_at else None,
            "milestones": milestones if rule_type == "first_to_targets" else [],
            "daily_wins": [],
            "samples": [_sample_payload(req, date_field) for req in samples],
            "quotes": [_quote_payload(q) for q in quotes],
        })

    if rule_type == "first_to_target":
        qualifiers = [r for r in results if r["reached_at"]]
        qualifiers.sort(key=lambda r: (r["reached_at"], r["sdr_name"]))
        winner_ids = {r["sdr_id"] for r in qualifiers[:max_winners]}
        for r in results:
            if r["sdr_id"] in winner_ids:
                r["payout_amount"] = round(bonus_amount, 2)
                r["spiff_payout"] = round(bonus_amount, 2)
                r["reason"] += f" Winner: ${bonus_amount:,.2f}."
            elif r["reached_at"]:
                r["reason"] += " Target reached, but not before winner cutoff."
    elif rule_type == "first_to_targets":
        for milestone in rule.get("first_to_targets", []):
            target = int(milestone.get("target_count") or 0)
            bonus = float(milestone.get("bonus_amount") or 0)
            max_winners_for_milestone = int(milestone.get("max_winners") or 1)
            qualifiers = [
                r for r in results
                for reached in r.get("milestones", [])
                if int(reached.get("target_count") or 0) == target and reached.get("reached_at")
            ]
            qualifiers.sort(key=lambda r: (next(reached["reached_at"] for reached in r["milestones"] if int(reached["target_count"]) == target), r["sdr_name"]))
            winner_ids = {r["sdr_id"] for r in qualifiers[:max_winners_for_milestone]}
            for r in results:
                if r["sdr_id"] in winner_ids:
                    r["payout_amount"] = round(float(r["payout_amount"]) + bonus, 2)
                    r["spiff_payout"] = round(float(r["spiff_payout"]) + bonus, 2)
                    r["reason"] += f" First to {target}: +${bonus:,.2f}."
    elif rule_type == "leaderboard":
        prizes = {int(p["rank"]): float(p["amount"]) for p in rule.get("leaderboard_prizes", [])}
        ranked = sorted(results, key=lambda r: (-r["eligible_sample_count"], r["sdr_name"]))
        for idx, r in enumerate(ranked, start=1):
            if idx in prizes:
                r["payout_amount"] = round(prizes[idx], 2)
                r["spiff_payout"] = round(prizes[idx], 2)
                r["reason"] += f" Rank #{idx}: ${prizes[idx]:,.2f}."
            else:
                r["reason"] += f" Rank #{idx}; no prize configured."
    elif rule_type == "daily_leader_bonus":
        daily_entries: Dict[date, List[Dict[str, Any]]] = defaultdict(list)
        for sdr_name, grouped in by_sdr.items():
            samples_by_day: Dict[date, List[SampleRequest]] = defaultdict(list)
            for sample in grouped["samples"]:
                d = _date_value(sample, date_field)
                if d:
                    samples_by_day[d].append(sample)
            for d, day_samples in samples_by_day.items():
                day_samples.sort(key=lambda sample: (_timestamp_value(sample, date_field), sample.id))
                daily_entries[d].append({
                    "sdr_name": sdr_name,
                    "sample_count": len(day_samples),
                    "reached_at": _timestamp_value(day_samples[-1], date_field),
                })
        winners_by_name: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        daily_bonus = float(rule.get("bonus_amount") or 0)
        tie_policy = (rule.get("tie_behavior") or "earliest_last_activity").strip().lower()
        if tie_policy == "rollover":
            rollover_start: Optional[date] = None
            rollover_days: List[date] = []
            rollover_counts: Dict[str, int] = defaultdict(int)
            for d in sorted(daily_entries):
                if rollover_start is None:
                    rollover_start = d
                    rollover_days = []
                    rollover_counts = defaultdict(int)
                rollover_days.append(d)
                for entry in daily_entries[d]:
                    rollover_counts[entry["sdr_name"]] += int(entry["sample_count"] or 0)
                ranked = sorted(rollover_counts.items(), key=lambda item: (-item[1], item[0]))
                if not ranked or ranked[0][1] <= 0:
                    continue
                if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
                    continue
                winner_name, sample_count = ranked[0]
                winners_by_name[winner_name].append({
                    "date": d.isoformat(),
                    "start_date": rollover_start.isoformat(),
                    "end_date": d.isoformat(),
                    "days": [day.isoformat() for day in rollover_days],
                    "sample_count": sample_count,
                    "amount": round(daily_bonus * len(rollover_days), 2),
                    "rolled_over_days": max(len(rollover_days) - 1, 0),
                })
                rollover_start = None
                rollover_days = []
                rollover_counts = defaultdict(int)
        else:
            for d, entries in daily_entries.items():
                entries.sort(key=lambda item: (-item["sample_count"], item["reached_at"], item["sdr_name"]))
                for winner in entries[:max_winners]:
                    winners_by_name[winner["sdr_name"]].append({
                        "date": d.isoformat(),
                        "sample_count": winner["sample_count"],
                        "amount": round(daily_bonus, 2),
                    })
        for r in results:
            wins = winners_by_name.get(r["sdr_name"], [])
            if wins:
                bonus = sum(float(win.get("amount") or 0) for win in wins)
                r["daily_wins"] = wins
                r["payout_amount"] = round(float(r["payout_amount"]) + bonus, 2)
                r["spiff_payout"] = round(float(r["spiff_payout"]) + bonus, 2)
                dates = ", ".join(
                    f"{win.get('start_date')} to {win.get('end_date')}" if win.get("rolled_over_days") else win["date"]
                    for win in wins
                )
                r["reason"] += f" Won {len(wins)} daily top-SDR payout(s) ({dates}): +${bonus:,.2f}."
            else:
                r["reason"] += " No daily top-SDR wins."

    results.sort(key=lambda r: (-r["payout_amount"], -r["eligible_sample_count"], r["sdr_name"]))
    return {
        "rule": rule,
        "results": results,
        "totals": {
            "sdr_count": len(results),
            "sample_count": sum(r["eligible_sample_count"] for r in results),
            "quote_count": sum(r["eligible_quote_count"] for r in results),
            "unit_count": sum(r["eligible_unit_count"] for r in results),
            "payout_amount": round(sum(r["payout_amount"] for r in results), 2),
        },
    }


def preview_spiff(db: Session, prompt: str) -> Dict[str, Any]:
    rule = interpret_spiff_prompt(prompt)
    preview = calculate_preview(db, rule)
    preview["natural_language_prompt"] = prompt
    return preview


def monthly_dashboard(db: Session, month: str) -> Dict[str, Any]:
    month_start, month_end = _month_bounds(month)
    return _base_commission_report(db, month_start, month_end, f"{month} SDR commission")
