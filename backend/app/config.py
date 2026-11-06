"""Settings, read from environment variables (or backend/.env). API keys live ONLY here."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "PredictPro"
    environment: Literal["development", "test", "production"] = "development"

    # Storage. SQLite works for a quick start; use PostgreSQL for anything shared.
    database_url: str = "sqlite:///./predictpro.db"
    redis_url: Optional[str] = None  # unset -> in-process cache + SQL leaderboards

    # Auth. "dev" = email/password handled by this API (local only).
    # "supabase" = verify Supabase-issued JWTs (email, Google and phone OTP sign-in).
    auth_mode: Literal["dev", "supabase"] = "dev"
    jwt_secret: str = "dev-only-change-me-please-32-bytes-min"
    jwt_ttl_hours: int = 24 * 30
    supabase_url: Optional[str] = None
    supabase_jwt_secret: Optional[str] = None  # legacy HS256 secret; if unset, JWKS is used
    supabase_service_role_key: Optional[str] = None  # used only to delete auth users on account deletion

    # Data providers. "mock" needs no keys and simulates live matches.
    data_provider: str = "mock"
    provider_football: Optional[str] = None  # override per sport, e.g. "football_data" or "api_sports"
    provider_basketball: Optional[str] = None
    football_data_api_key: Optional[str] = None
    api_sports_key: Optional[str] = None
    provider_requests_per_minute: int = 10  # free tiers are tight; the adapter layer enforces this
    mock_seed: int = 2026
    mock_history_weeks: int = 14

    # Background jobs
    run_scheduler: bool = True  # run jobs inside the API process (dev). Use the worker in production.
    live_poll_seconds: int = 30
    fixtures_sync_minutes: int = 30
    predictions_minutes: int = 15
    fixture_window_days: int = 14

    # Game
    season_start_month: int = 7  # the game "season" (e.g. 2026-27) starts in July

    admin_token: Optional[str] = None
    cors_origins: str = "*"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    def provider_for_sport(self, sport: str) -> str:
        return getattr(self, f"provider_{sport}", None) or self.data_provider


@lru_cache
def get_settings() -> Settings:
    return Settings()
