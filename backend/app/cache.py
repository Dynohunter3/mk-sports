"""JSON cache: Redis when REDIS_URL is set, otherwise an in-process TTL dict."""

from __future__ import annotations

import json
import threading
import time
from typing import Any, Callable, Optional

from .config import get_settings


class MemoryCache:
    def __init__(self, max_items: int = 5000):
        self._data: dict[str, tuple[float, str]] = {}
        self._lock = threading.Lock()
        self.max_items = max_items

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            item = self._data.get(key)
            if not item:
                return None
            expires, raw = item
            if expires < time.monotonic():
                self._data.pop(key, None)
                return None
            return json.loads(raw)

    def set(self, key: str, value: Any, ttl: int) -> None:
        raw = json.dumps(value, default=str)
        with self._lock:
            if len(self._data) >= self.max_items:
                now = time.monotonic()
                for k in [k for k, (e, _) in self._data.items() if e < now] or list(self._data)[: self.max_items // 10]:
                    self._data.pop(k, None)
            self._data[key] = (time.monotonic() + ttl, raw)

    def delete_prefix(self, prefix: str) -> None:
        with self._lock:
            for k in [k for k in self._data if k.startswith(prefix)]:
                self._data.pop(k, None)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


class RedisCache:
    def __init__(self, url: str):
        import redis

        self.r = redis.Redis.from_url(url, decode_responses=True, socket_timeout=2)

    def get(self, key: str) -> Optional[Any]:
        try:
            raw = self.r.get(key)
        except Exception:  # cache must never take the API down
            return None
        return json.loads(raw) if raw else None

    def set(self, key: str, value: Any, ttl: int) -> None:
        try:
            self.r.set(key, json.dumps(value, default=str), ex=ttl)
        except Exception:
            pass

    def delete_prefix(self, prefix: str) -> None:
        try:
            for k in self.r.scan_iter(f"{prefix}*", count=500):
                self.r.delete(k)
        except Exception:
            pass

    def clear(self) -> None:
        self.delete_prefix("c:")


_cache: Optional[MemoryCache | RedisCache] = None


def get_cache() -> MemoryCache | RedisCache:
    global _cache
    if _cache is None:
        url = get_settings().redis_url
        _cache = RedisCache(url) if url else MemoryCache()
    return _cache


def reset_cache(cache: Optional[MemoryCache | RedisCache] = None) -> None:
    global _cache
    _cache = cache


def cached(key: str, ttl: int, fn: Callable[[], Any]) -> Any:
    cache = get_cache()
    full = f"c:{key}"
    hit = cache.get(full)
    if hit is not None:
        return hit
    value = fn()
    cache.set(full, value, ttl)
    return value


def invalidate(prefix: str = "") -> None:
    get_cache().delete_prefix(f"c:{prefix}")


def data_version() -> str:
    """Bumped whenever match data changes; included in cache keys so stale entries are skipped."""
    v = get_cache().get("c:data_version")
    return str(v) if v is not None else "0"


def bump_data_version() -> None:
    import uuid

    get_cache().set("c:data_version", uuid.uuid4().hex[:8], 7 * 24 * 3600)
