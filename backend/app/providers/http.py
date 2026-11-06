"""HTTP client for real providers: rate limiting, response caching, retries.

Free tiers are tight (football-data.org: 10 req/min; API-Sports: 100 req/day), so:
* a token bucket per provider keeps us under the per-minute limit,
* GET responses are cached (Redis if configured) with per-call TTLs,
* 429/5xx are retried with exponential backoff, honouring Retry-After.
Keys are read from server-side settings only and never sent to clients.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from typing import Any, Optional

import httpx

from ..cache import get_cache
from .base import ProviderError

log = logging.getLogger(__name__)


class TokenBucket:
    def __init__(self, per_minute: int):
        self.capacity = max(1, per_minute)
        self.tokens = float(self.capacity)
        self.rate = self.capacity / 60.0
        self.updated = time.monotonic()
        self.lock = threading.Lock()

    def acquire(self, timeout: float = 120.0) -> None:
        deadline = time.monotonic() + timeout
        while True:
            with self.lock:
                now = time.monotonic()
                self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
                self.updated = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                wait = (1 - self.tokens) / self.rate
            if time.monotonic() + wait > deadline:
                raise ProviderError("rate limit budget exhausted")
            time.sleep(min(wait, 5))


class ProviderHttp:
    def __init__(self, name: str, base_url: str, headers: dict[str, str], per_minute: int, timeout: float = 15.0, transport: Optional[httpx.BaseTransport] = None):
        self.name = name
        self.bucket = TokenBucket(per_minute)
        self.client = httpx.Client(base_url=base_url, headers=headers, timeout=timeout, transport=transport)

    def get(self, path: str, params: Optional[dict[str, Any]] = None, ttl: int = 300, retries: int = 3) -> Any:
        key = "p:" + self.name + ":" + hashlib.sha1(json.dumps([path, params], sort_keys=True, default=str).encode()).hexdigest()
        cache = get_cache()
        if ttl > 0:
            hit = cache.get(key)
            if hit is not None:
                return hit
        delay = 2.0
        for attempt in range(retries + 1):
            self.bucket.acquire()
            try:
                resp = self.client.get(path, params=params)
            except httpx.HTTPError as exc:
                if attempt == retries:
                    raise ProviderError(f"{self.name}: {exc}") from exc
                time.sleep(delay)
                delay *= 2
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt == retries:
                    raise ProviderError(f"{self.name}: HTTP {resp.status_code}")
                retry_after = resp.headers.get("Retry-After")
                time.sleep(float(retry_after) if retry_after and retry_after.isdigit() else delay)
                delay *= 2
                continue
            if resp.status_code >= 400:
                raise ProviderError(f"{self.name}: HTTP {resp.status_code} for {path}: {resp.text[:200]}")
            data = resp.json()
            if ttl > 0:
                cache.set(key, data, ttl)
            return data
        raise ProviderError(f"{self.name}: request failed")  # pragma: no cover
