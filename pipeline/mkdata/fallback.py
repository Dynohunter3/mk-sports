"""Automatic fallback between sources, with a circuit breaker and a log of every switch.

Two modes:
  collect_all    fetch every usable source (results: we want them all, to cross-check). A failing
                 source is logged and skipped; the others still land.
  first_success  try sources in reliability order and stop at the first good answer (quota-limited
                 data such as current odds). Each step down is logged as a fallback event.
If every source fails, nothing is overwritten: the store keeps the last good data, the result is
marked degraded, an alert is raised, and predictions continue from what is stored.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable

from .adapters.base import Adapter, FetchResult, Unsupported
from .store import Store

BREAKER_FAILURES = 3
BREAKER_COOLDOWN_S = 6 * 3600


@dataclass
class ChainResult:
    data: FetchResult = field(default_factory=FetchResult)
    used: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)
    skipped: dict[str, str] = field(default_factory=dict)
    degraded: bool = False


def breaker_open(store: Store, source: str, now: float) -> bool:
    runs = store.q("SELECT ok, finished_at FROM source_runs WHERE source=? ORDER BY id DESC LIMIT ?", source, BREAKER_FAILURES)
    return (
        len(runs) == BREAKER_FAILURES
        and all(not r["ok"] for r in runs)
        and now - (runs[0]["finished_at"] or 0) < BREAKER_COOLDOWN_S
    )


def run_chain(
    store: Store,
    category: str,
    scope: str,
    adapters: list[Adapter],
    call: Callable[[Adapter], FetchResult],
    *,
    mode: str = "collect_all",
    validate: Callable[[FetchResult], str | None] | None = None,
    clock: Callable[[], float] = time.time,
) -> ChainResult:
    out = ChainResult()
    usable = []
    for a in adapters:
        ok, why = a.usable()
        if not ok:
            out.skipped[a.name] = why
        elif breaker_open(store, a.name, clock()):
            out.skipped[a.name] = "circuit open after repeated failures"
            store.log_fallback(category, scope, a.name, None, "circuit open")
        else:
            usable.append(a)
    for i, a in enumerate(usable):
        started = clock()
        try:
            res = call(a)
            problem = validate(res) if validate else (None if len(res) else "empty response")
        except Unsupported as e:
            out.skipped[a.name] = str(e)
            continue
        except Exception as e:  # noqa: BLE001 - any adapter failure must not stop the job
            problem = f"{type(e).__name__}: {e}"
            res = None
        if problem:
            store.log_run(a.name, f"{category}:{scope}", started, False, 0, problem)
            out.failed[a.name] = problem
            nxt = next((b.name for b in usable[i + 1:]), None)
            store.log_fallback(category, scope, a.name, nxt, problem)
            continue
        store.log_run(a.name, f"{category}:{scope}", started, True, len(res))
        out.data.extend(res)
        out.used.append(a.name)
        if mode == "first_success":
            break
    if not out.used:
        out.degraded = True
        if usable:
            store.raise_alert("source_failure", f"{category}:{scope}", "critical",
                              f"every usable source failed ({out.failed}); serving last stored data")
    return out
