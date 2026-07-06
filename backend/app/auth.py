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
