from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import spiff_service

router = APIRouter(prefix="/api/spiff", tags=["spiff"])


class SpiffPreviewRequest(BaseModel):
    prompt: str = ""
    start_date: str
    end_date: str


class SpiffApplyRequest(BaseModel):
    month: str
    rule: dict | None = None
    rules: list[dict] | None = None


class SpiffRulePreviewRequest(BaseModel):
    rules: list[dict]


class SpiffCampaignCreate(BaseModel):
    prompt: str = ""
    rule: dict


class SpiffCampaignCreateRequest(BaseModel):
    campaigns: list[SpiffCampaignCreate]
    created_by: str | None = None


@router.get("/mock/monthly/{month}")
def monthly_spiff_dashboard(month: str, db: Session = Depends(get_db)):
    try:
        return spiff_service.monthly_dashboard(db, month)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Monthly SPIFF dashboard failed: {e}")


@router.post("/mock/preview")
def preview_spiff(data: SpiffPreviewRequest, db: Session = Depends(get_db)):
    if not data.prompt.strip() or not data.start_date.strip() or not data.end_date.strip():
        raise HTTPException(status_code=422, detail="Start date, end date, and SPIFF rule are required.")
    prompt = f"From {data.start_date} to {data.end_date}, {data.prompt.strip()}"
    try:
        return spiff_service.preview_spiff(db, prompt)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"SPIFF preview failed: {e}")


@router.post("/mock/preview-rules")
def preview_rules(data: SpiffRulePreviewRequest, db: Session = Depends(get_db)):
    if not data.rules:
        raise HTTPException(status_code=422, detail="At least one SPIFF rule is required.")
    try:
        if len(data.rules) == 1:
            return spiff_service.calculate_preview(db, data.rules[0])
        return {
            "rule": {
                "name": "Traditional SPIFF preview",
                "rule_type": "applied_spiff",
                "start_date": min(rule["start_date"] for rule in data.rules),
                "end_date": max(rule["end_date"] for rule in data.rules),
                "entity_type": "both",
                "applied_spiff_rules": data.rules,
            },
            "results": [],
            "totals": {
                "sdr_count": 0,
                "sample_count": 0,
                "quote_count": 0,
                "unit_count": 0,
                "payout_amount": 0,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SPIFF rule preview failed: {e}")


@router.post("/mock/apply")
def apply_spiff(data: SpiffApplyRequest, db: Session = Depends(get_db)):
    rules = data.rules if data.rules is not None else ([data.rule] if data.rule else [])
    if not data.month.strip():
        raise HTTPException(status_code=422, detail="Month is required.")
    try:
        return spiff_service.apply_rules_to_month(db, data.month, rules)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SPIFF apply failed: {e}")


@router.get("/campaigns/{month}")
def list_spiff_campaigns(month: str, db: Session = Depends(get_db)):
    if not month.strip():
        raise HTTPException(status_code=422, detail="Month is required.")
    try:
        return spiff_service.list_campaigns(db, month)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SPIFF campaigns failed: {e}")


@router.post("/campaigns/{month}")
def create_spiff_campaigns(month: str, data: SpiffCampaignCreateRequest, db: Session = Depends(get_db)):
    if not month.strip():
        raise HTTPException(status_code=422, detail="Month is required.")
    if not data.campaigns:
        raise HTTPException(status_code=422, detail="At least one SPIFF campaign is required.")
    try:
        return spiff_service.create_campaigns(
            db,
            month,
            [campaign.model_dump() for campaign in data.campaigns],
            data.created_by,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Create SPIFF campaigns failed: {e}")


@router.delete("/campaigns/{campaign_id}")
def delete_spiff_campaign(campaign_id: str, db: Session = Depends(get_db)):
    try:
        month = spiff_service.delete_campaign(db, campaign_id)
        if not month:
            raise HTTPException(status_code=404, detail="SPIFF campaign not found.")
        return spiff_service.list_campaigns(db, month)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Delete SPIFF campaign failed: {e}")


@router.delete("/campaigns/month/{month}")
def clear_spiff_campaigns(month: str, db: Session = Depends(get_db)):
    if not month.strip():
        raise HTTPException(status_code=422, detail="Month is required.")
    try:
        spiff_service.clear_campaigns(db, month)
        return []
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Clear SPIFF campaigns failed: {e}")
