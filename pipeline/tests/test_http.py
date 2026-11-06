import pytest

from conftest import FakeClock, FakeTransport
from mkdata.http import Blocked, FetchError, HttpClient


def client(routes, tmp_path=None):
    clock = FakeClock()
    t = FakeTransport(routes)
    return HttpClient(cache_dir=tmp_path, transport=t, clock=clock, sleep=clock.sleep), t, clock


def test_robots_disallow_blocks_request():
    c, t, _ = client({"https://site.test/robots.txt": [(200, "User-agent: *\nDisallow: /private/\n", {})],
                      "https://site.test/": [(200, "ok", {})]})
    assert c.get("https://site.test/public.csv", use_cache=False).text() == "ok"
    with pytest.raises(Blocked):
        c.get("https://site.test/private/x.csv", use_cache=False)
    assert not any("/private/" in u for u, _ in t.calls)


def test_rate_limit_spaces_requests_per_host():
    c, t, clock = client({"https://a.test/": [(200, "x", {})]})
    for i in range(3):
        c.get(f"https://a.test/{i}", check_robots=False, use_cache=False, min_interval=2.0)
    assert clock.sleeps == [2.0, 2.0]


def test_auth_errors_are_never_retried():
    c, t, _ = client({"https://api.test/": [(403, "no", {})]})
    with pytest.raises(Blocked):
        c.get("https://api.test/x", check_robots=False, use_cache=False)
    assert len(t.calls) == 1


def test_429_honours_retry_after_once_then_gives_up():
    c, t, clock = client({"https://api.test/": [(429, "", {"retry-after": "5"}), (429, "", {"retry-after": "5"})]})
    with pytest.raises(Blocked):
        c.get("https://api.test/x", check_robots=False, use_cache=False)
    assert len(t.calls) == 2 and 5 in clock.sleeps


def test_server_errors_retry_with_backoff_then_succeed():
    c, t, clock = client({"https://api.test/": [(503, "", {}), (502, "", {}), (200, "fine", {})]})
    assert c.get("https://api.test/x", check_robots=False, use_cache=False, min_interval=0).text() == "fine"
    assert clock.sleeps[:2] == [2.0, 4.0]


def test_network_errors_exhaust_into_fetch_error():
    c, t, _ = client({"https://api.test/": [ConnectionResetError("reset")]})
    with pytest.raises(FetchError):
        c.get("https://api.test/x", check_robots=False, use_cache=False, min_interval=0)
    assert len(t.calls) == 4


def test_keys_are_redacted_everywhere(tmp_path):
    key = "sk_live_ABC123"
    c, t, _ = client({"https://api.test/": [(200, "{}", {})]}, tmp_path)
    r = c.get(f"https://api.test/odds?apiKey={key}", secrets=[key], check_robots=False)
    assert key not in r.url
    for f in tmp_path.rglob("*"):
        if f.is_file():
            assert key not in f.read_text(errors="ignore")
    c2, _, _ = client({"https://api.test/": [(500, "", {})]})
    c2.retries = 0
    with pytest.raises(FetchError) as e:
        c2.get(f"https://api.test/odds?apiKey={key}", secrets=[key], check_robots=False, use_cache=False)
    assert key not in str(e.value)


def test_cache_serves_within_max_age(tmp_path):
    c, t, clock = client({"https://a.test/": [(200, "v1", {})]}, tmp_path)
    c.get("https://a.test/f", check_robots=False)
    assert c.get("https://a.test/f", check_robots=False, max_age=60).from_cache
    clock.t += 120
    assert not c.get("https://a.test/f", check_robots=False, max_age=60).from_cache
    assert len(t.calls) == 2
