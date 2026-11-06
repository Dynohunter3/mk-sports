"""Authentication.

AUTH_MODE=dev       email + password handled here (scrypt hashes, HS256 JWTs). Local use only.
AUTH_MODE=supabase  the app signs in with Supabase Auth (email, Google, phone OTP); we only
                    verify Supabase's JWT (HS256 secret or JWKS) and provision a local user row.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import random
from datetime import timedelta
from functools import lru_cache
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import get_db, utcnow
from .models import User

SCRYPT = {"n": 2**14, "r": 8, "p": 1}


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **SCRYPT)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, stored: Optional[str]) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        return False
    _, salt_b64, digest_b64 = stored.split("$")
    digest = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64), dklen=32, **SCRYPT)
    return hmac.compare_digest(digest, base64.b64decode(digest_b64))


def create_dev_token(user: User, settings: Optional[Settings] = None) -> str:
    settings = settings or get_settings()
    now = utcnow()
    payload = {"sub": user.id, "iss": "predictpro-dev", "iat": now, "exp": now + timedelta(hours=settings.jwt_ttl_hours)}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


@lru_cache
def _jwks_client(url: str):
    return jwt.PyJWKClient(url, cache_keys=True)


def decode_token(token: str, settings: Settings) -> dict:
    try:
        if settings.auth_mode == "dev":
            return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], issuer="predictpro-dev")
        if settings.supabase_jwt_secret:
            return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
        if not settings.supabase_url:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Supabase auth is not configured")
        key = _jwks_client(settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json").get_signing_key_from_jwt(token)
        return jwt.decode(token, key.key, algorithms=["RS256", "ES256"], audience="authenticated")
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"}) from exc


def _provision_supabase_user(db: Session, claims: dict) -> User:
    meta = claims.get("user_metadata") or {}
    email = claims.get("email") or None
    phone = claims.get("phone") or None
    name = meta.get("full_name") or meta.get("name") or (email.split("@")[0] if email else None) or f"Player{random.randint(1000, 9999)}"
    user = User(auth_provider="supabase", auth_subject=claims["sub"], email=email, phone=phone, display_name=name[:60])
    db.add(user)
    db.commit()
    return user


def _user_from_header(authorization: Optional[str], db: Session, settings: Settings) -> Optional[User]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Expected a Bearer token")
    claims = decode_token(token, settings)
    if settings.auth_mode == "dev":
        user = db.get(User, claims["sub"])
    else:
        user = db.scalar(select(User).where(User.auth_provider == "supabase", User.auth_subject == claims["sub"]))
        if user is None:
            user = _provision_supabase_user(db, claims)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account no longer exists")
    return user


def optional_user(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)) -> Optional[User]:
    return _user_from_header(authorization, db, get_settings())


def current_user(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)) -> User:
    user = _user_from_header(authorization, db, get_settings())
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in required", headers={"WWW-Authenticate": "Bearer"})
    return user


def consented_user(user: User = Depends(current_user)) -> User:
    if user.terms_accepted_at is None or user.privacy_accepted_at is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "consent_required", "message": "Please accept the terms and privacy policy first"})
    return user


def require_admin(x_admin_token: Optional[str] = Header(default=None)) -> None:
    expected = get_settings().admin_token
    if not expected or not x_admin_token or not hmac.compare_digest(expected, x_admin_token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin token required")
