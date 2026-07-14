from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from app.auth import check_password, create_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


class TokenRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/token", response_model=TokenResponse)
def get_token(body: TokenRequest):
    if not check_password(body.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password",
        )
    return TokenResponse(access_token=create_token())
