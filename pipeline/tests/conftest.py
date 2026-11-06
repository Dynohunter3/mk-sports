import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mkdata.adapters import load_competitions  # noqa: E402
from mkdata.ids import IdRegistry  # noqa: E402
from mkdata.store import Store  # noqa: E402


class FakeTransport:
    """Scripted HTTP: url (or prefix) -> list of (status, body, headers) answered in order."""

    def __init__(self, routes=None):
        self.routes = routes or {}
        self.calls = []

    def __call__(self, url, headers, timeout):
        self.calls.append((url, headers))
        for prefix, answers in self.routes.items():
            if url.startswith(prefix):
                a = answers.pop(0) if len(answers) > 1 else answers[0]
                if isinstance(a, Exception):
                    raise a
                status, body, h = a
                return status, body.encode() if isinstance(body, str) else body, h
        return 404, b"", {}


class FakeClock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t
        self.sleeps = []

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s


@pytest.fixture
def comps():
    return load_competitions()


@pytest.fixture
def store():
    s = Store(":memory:")
    yield s
    s.close()


@pytest.fixture
def ids(store):
    return IdRegistry(store)
