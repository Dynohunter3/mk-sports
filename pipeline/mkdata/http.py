"""Polite HTTP client used by every adapter.

* identifies itself with a fixed User-Agent;
* checks robots.txt before fetching from a website (API hosts covered by their own terms skip it);
* spaces requests per host by the source's published limit and never tries to get around a 401,
  403 or 429 (it honours Retry-After once and then gives up);
* retries network errors and 5xx with exponential backoff;
* caches responses on disk with the time they were fetched;
* keeps API keys out of logs, cache file names and error messages.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

log = logging.getLogger("mkdata.http")

USER_AGENT = "MKSportsDataPipeline/0.1 (+server-side data job; respects robots.txt)"


class FetchError(Exception):
    def __init__(self, url: str, status: int | None, reason: str):
        super().__init__(f"{status or 'network'} {reason} for {url}")
        self.url, self.status, self.reason = url, status, reason


class Blocked(FetchError):
    """robots.txt, terms, auth or quota say no. Never retried."""


@dataclass
class Response:
    url: str
    status: int
    body: bytes
    headers: dict[str, str]
    fetched_at: float
    from_cache: bool = False

    def text(self) -> str:
        return self.body.decode("utf-8-sig", errors="replace")

    def json(self):
        return json.loads(self.text())


class Transport(Protocol):
    def __call__(self, url: str, headers: dict[str, str], timeout: float) -> tuple[int, bytes, dict[str, str]]: ...


def urllib_transport(url: str, headers: dict[str, str], timeout: float) -> tuple[int, bytes, dict[str, str]]:
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read() if e.fp else b"", {k.lower(): v for k, v in (e.headers or {}).items()}


def redact(url: str, secrets: list[str]) -> str:
    for s in secrets:
        if s:
            url = url.replace(s, "***")
            url = url.replace(urllib.parse.quote(s, safe=""), "***")
    return url


class HttpClient:
    def __init__(
        self,
        cache_dir: Path | None = None,
        transport: Transport = urllib_transport,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
        retries: int = 3,
        timeout: float = 30.0,
    ):
        self.cache_dir = cache_dir
        self.transport = transport
        self.clock = clock
        self.sleep = sleep
        self.retries = retries
        self.timeout = timeout
        self._last: dict[str, float] = {}
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self.requests_made = 0

    # -- politeness -------------------------------------------------------------------------
    def _wait(self, host: str, min_interval: float) -> None:
        last = self._last.get(host)
        if last is not None:
            gap = self.clock() - last
            if gap < min_interval:
                self.sleep(min_interval - gap)
        self._last[host] = self.clock()

    def robots_allows(self, url: str) -> bool:
        p = urllib.parse.urlsplit(url)
        base = f"{p.scheme}://{p.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                status, body, _ = self.transport(base + "/robots.txt", {"User-Agent": USER_AGENT}, self.timeout)
            except OSError:
                status, body = None, b""
            if status == 200 and not body.lstrip().startswith(b"<"):
                rp.parse(body.decode("utf-8", "replace").splitlines())
                self._robots[base] = rp
            elif status in (401, 403):
                # robots.txt itself refused: treat as "do not crawl"
                rp.parse(["User-agent: *", "Disallow: /"])
                self._robots[base] = rp
            else:
                self._robots[base] = None  # no robots.txt -> no robots restriction
        rp = self._robots[base]
        return True if rp is None else rp.can_fetch(USER_AGENT, url)

    # -- cache ------------------------------------------------------------------------------
    def _cache_path(self, safe_url: str) -> Path | None:
        if not self.cache_dir:
            return None
        h = hashlib.sha256(safe_url.encode()).hexdigest()[:32]
        return self.cache_dir / h[:2] / f"{h}.json"

    def _read_cache(self, safe_url: str, max_age: float | None) -> Response | None:
        path = self._cache_path(safe_url)
        if not path or not path.exists():
            return None
        meta = json.loads(path.read_text())
        if max_age is not None and self.clock() - meta["fetched_at"] > max_age:
            return None
        body = path.with_suffix(".body").read_bytes()
        return Response(meta["url"], meta["status"], body, meta["headers"], meta["fetched_at"], from_cache=True)

    def _write_cache(self, safe_url: str, r: Response) -> None:
        path = self._cache_path(safe_url)
        if not path:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.with_suffix(".body").write_bytes(r.body)
        path.write_text(json.dumps({"url": safe_url, "status": r.status, "headers": r.headers, "fetched_at": r.fetched_at}))

    # -- fetch ------------------------------------------------------------------------------
    def get(
        self,
        url: str,
        *,
        min_interval: float = 1.0,
        headers: dict[str, str] | None = None,
        secrets: list[str] | None = None,
        check_robots: bool = True,
        max_age: float | None = None,
        use_cache: bool = True,
    ) -> Response:
        secrets = secrets or []
        safe = redact(url, secrets)
        if use_cache:
            hit = self._read_cache(safe, max_age)
            if hit:
                return hit
        if check_robots and not self.robots_allows(url):
            raise Blocked(safe, None, "disallowed by robots.txt")
        host = urllib.parse.urlsplit(url).netloc
        h = {"User-Agent": USER_AGENT, "Accept-Encoding": "identity", **(headers or {})}
        delay = 2.0
        retried_after = False
        for attempt in range(self.retries + 1):
            self._wait(host, min_interval)
            self.requests_made += 1
            try:
                status, body, rh = self.transport(url, h, self.timeout)
            except OSError as e:  # network error: retry with backoff
                if attempt == self.retries:
                    raise FetchError(safe, None, redact(str(e), secrets)) from None
                log.warning("network error on %s (%s), retry %d", safe, type(e).__name__, attempt + 1)
                self.sleep(delay)
                delay *= 2
                continue
            if status == 200:
                r = Response(safe, status, body, rh, self.clock())
                if use_cache:
                    self._write_cache(safe, r)
                return r
            if status in (401, 403):
                raise Blocked(safe, status, "not authorised (check key / terms); not retried")
            if status == 429:
                ra = rh.get("retry-after", "")
                if not retried_after and ra.isdigit() and int(ra) <= 120:
                    retried_after = True
                    self.sleep(int(ra))
                    continue
                raise Blocked(safe, status, "rate limited; not retried")
            if status >= 500 and attempt < self.retries:
                log.warning("HTTP %d on %s, retry %d", status, safe, attempt + 1)
                self.sleep(delay)
                delay *= 2
                continue
            raise FetchError(safe, status, "unexpected status")
        raise FetchError(safe, None, "exhausted retries")
