"""
Shared-password JWT auth.

How it works:
1. POST /api/auth/token with {"password": "..."} → returns a signed JWT
2. JWT is valid for 24 hours
3. Every protected API route uses Depends(verify_token)
4. 401 on missing/expired/invalid token

To generate APP_PASSWORD_HASH for your .env:
    python scripts/hash_password.py yourpassword
"""
import os
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-before-deploying")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()

# Fallback plaintext password for local dev — NEVER use in production
APP_PASSWORD_HASH = os.getenv("APP_PASSWORD_HASH", "")
APP_PASSWORD_PLAINTEXT = os.getenv("APP_PASSWORD", "demo1234")


def check_password(plain: str) -> bool:
    if APP_PASSWORD_HASH:
        return pwd_context.verify(plain, APP_PASSWORD_HASH)
    # dev fallback: compare plaintext directly
    return plain == APP_PASSWORD_PLAINTEXT


def create_token() -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode({"exp": expire, "sub": "portal"}, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("sub") != "portal":
            raise JWTError()
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ─────────────────────────────────────────────────────────────────────────
# SDR-form auth — deliberately separate from the admin password above.
# Same JWT mechanism, different "sub" claim, so a leaked/shared SDR code
# can never be used to reach admin-only routes, and vice versa.
# ─────────────────────────────────────────────────────────────────────────
SDR_FORM_CODE_HASH = os.getenv("SDR_FORM_CODE_HASH", "")
SDR_FORM_CODE_PLAINTEXT = os.getenv("SDR_FORM_CODE")
SDR_TOKEN_EXPIRE_HOURS = 12


def check_sdr_code(plain: str) -> bool:
    if SDR_FORM_CODE_PLAINTEXT:
        return plain == SDR_FORM_CODE_PLAINTEXT
    if SDR_FORM_CODE_HASH:
        return pwd_context.verify(plain, SDR_FORM_CODE_HASH)
    return plain == "samples1234"


def create_sdr_token() -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=SDR_TOKEN_EXPIRE_HOURS)
    return jwt.encode({"exp": expire, "sub": "sdr_form"}, SECRET_KEY, algorithm=ALGORITHM)


def verify_sdr_token(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("sub") != "sdr_form":
            raise JWTError()
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired SDR access code session",
            headers={"WWW-Authenticate": "Bearer"},
        )
