"""Test setup: an isolated SQLite database seeded once from the mock provider."""

import os
import tempfile
import uuid

_TMP = tempfile.mkdtemp(prefix="predictpro-test-")
os.environ.update(
    DATABASE_URL=f"sqlite:///{_TMP}/test.db",
    REDIS_URL="",
    RUN_SCHEDULER="false",
    AUTH_MODE="dev",
    ENVIRONMENT="test",
    MOCK_HISTORY_WEEKS="5",
    ADMIN_TOKEN="test-admin-token",
    DATA_PROVIDER="mock",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db as dbmod  # noqa: E402
from app.cache import MemoryCache, reset_cache  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.services.leaderboards import SqlLeaderboard, reset_store  # noqa: E402

get_settings.cache_clear()


@pytest.fixture(scope="session")
def seeded():
    from app import models  # noqa: F401
    from app.seed import seed_all

    engine = dbmod.configure(os.environ["DATABASE_URL"])
    dbmod.Base.metadata.create_all(engine)
    reset_cache(MemoryCache())
    reset_store(SqlLeaderboard())
    with dbmod.session_scope() as db:
        report = seed_all(db, get_settings(), users=True, live=True)
    return report


@pytest.fixture
def db(seeded):
    s = dbmod.SessionLocal()
    yield s
    s.rollback()
    s.close()


@pytest.fixture(scope="session")
def client(seeded):
    from app.main import create_app

    with TestClient(create_app(run_scheduler=False)) as c:
        yield c


@pytest.fixture
def make_user(client):
    """Register a fresh user and return (auth headers, user id)."""

    def _make(name: str = "Tester"):
        email = f"{uuid.uuid4().hex[:10]}@example.com"
        r = client.post("/api/v1/auth/register", json={"email": email, "password": "s3cret-pass", "display_name": name, "accept_terms": True, "accept_privacy": True})
        assert r.status_code == 201, r.text
        body = r.json()
        return {"Authorization": f"Bearer {body['access_token']}"}, body["user_id"]

    return _make
