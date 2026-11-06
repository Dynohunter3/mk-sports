from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import create_dev_token, hash_password, verify_password
from ..config import get_settings
from ..db import get_db, utcnow
from ..models import User
from ..schemas import LoginIn, RegisterIn, TokenOut

router = APIRouter(prefix="/auth", tags=["auth"])

DEMO_EMAIL = "demo@predictpro.app"


def _dev_only() -> None:
    if get_settings().auth_mode != "dev":
        raise HTTPException(404, "Not available: this server uses Supabase Auth (sign in from the app)")


@router.get("/config", summary="Which sign-in methods the app should offer")
def auth_config():
    s = get_settings()
    if s.auth_mode == "supabase":
        return {"mode": "supabase", "methods": ["email", "google", "phone"]}
    return {"mode": "dev", "methods": ["email"], "demo_account": s.environment != "production"}


@router.post("/register", response_model=TokenOut, status_code=201, summary="Create an account (dev auth mode)")
def register(body: RegisterIn, db: Session = Depends(get_db)):
    _dev_only()
    if not (body.accept_terms and body.accept_privacy):
        raise HTTPException(422, detail={"code": "consent_required", "message": "You must accept the terms and privacy policy"})
    email = body.email.lower()
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(409, detail={"code": "email_taken", "message": "An account with this email already exists"})
    now = utcnow()
    user = User(
        auth_provider="dev", auth_subject=email, email=email, password_hash=hash_password(body.password), display_name=body.display_name.strip(),
        terms_accepted_at=now, privacy_accepted_at=now, marketing_opt_in=body.marketing_opt_in,
    )
    db.add(user)
    db.commit()
    return {"access_token": create_dev_token(user), "user_id": user.id}


@router.post("/login", response_model=TokenOut, summary="Sign in (dev auth mode)")
def login(body: LoginIn, db: Session = Depends(get_db)):
    _dev_only()
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.lower(), User.auth_provider == "dev"))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, detail={"code": "bad_credentials", "message": "Wrong email or password"})
    return {"access_token": create_dev_token(user), "user_id": user.id}


@router.post("/demo", response_model=TokenOut, summary="Sign in as the seeded demo user (development only)")
def demo_login(db: Session = Depends(get_db)):
    _dev_only()
    if get_settings().environment == "production":
        raise HTTPException(404, "Not available")
    user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
    if user is None:
        raise HTTPException(404, "Demo user not seeded; run `python -m app.cli seed`")
    return {"access_token": create_dev_token(user), "user_id": user.id}
