"""Monitoring and alerts: failed sources, stale data, unresolved IDs, conflicts, accuracy drops.

``check()`` returns a JSON-able report with a list of alerts (severity info/warning/critical).
The CLI writes it to ``status.json``, exits non-zero on critical alerts (so the scheduled CI job
fails and GitHub notifies the owner), and optionally POSTs it to $MK_ALERT_WEBHOOK.
"""

from __future__ import annotations

import json
import math
import os
import urllib.request
from dataclasses import dataclass

from .sources import REGISTRY
from .store import Store

STALE_RESULT_S = 36 * 3600  # a match that kicked off this long ago should have a result
SOURCE_SILENT_S = 3 * 86400  # a usable source with no successful run for this long
ACCURACY_WINDOW = 200


@dataclass
class Alert:
    kind: str
    subject: str
    severity: str
    message: str

    def as_dict(self) -> dict:
        return self.__dict__


def source_health(store: Store, now: float) -> tuple[dict, list[Alert]]:
    alerts, out = [], {}
    for name, spec in REGISTRY.items():
        ok, why = spec.usable()
        runs = store.q("SELECT ok, finished_at, error FROM source_runs WHERE source=? ORDER BY id DESC LIMIT 20", name)
        last_ok = next((r["finished_at"] for r in runs if r["ok"]), None)
        streak = 0
        for r in runs:
            if r["ok"]:
                break
            streak += 1
        out[name] = {"usable": ok, "why": why, "runs": len(runs), "last_ok": last_ok, "failure_streak": streak,
                     "last_error": next((r["error"] for r in runs if not r["ok"]), None)}
        if ok and streak >= 3:
            alerts.append(Alert("source_failure", name, "warning", f"{streak} failed runs in a row: {out[name]['last_error']}"))
        if ok and runs and (last_ok is None or now - last_ok > SOURCE_SILENT_S):
            alerts.append(Alert("source_stale", name, "warning", "no successful fetch in 3 days"))
    return out, alerts


def stale_results(store: Store, now: float) -> tuple[dict, list[Alert]]:
    rows = store.q(
        """SELECT competition_id, COUNT(*) n, MIN(kickoff_utc) oldest FROM matches
           WHERE status IN ('scheduled','live') AND kickoff_utc < ? AND kickoff_utc > ? GROUP BY competition_id""",
        now - STALE_RESULT_S, now - 30 * 86400,
    )
    out = {r["competition_id"]: {"missing_results": r["n"], "oldest_kickoff": r["oldest"]} for r in rows}
    alerts = [Alert("stale_data", c, "critical" if v["missing_results"] >= 5 else "warning",
                    f"{v['missing_results']} matches that kicked off over 36 h ago still have no result")
              for c, v in out.items()]
    return out, alerts


def accuracy_drop(store: Store, baselines: dict[str, float], window: int = ACCURACY_WINDOW) -> tuple[dict, list[Alert]]:
    """Rolling log loss of the last ``window`` graded predictions per competition vs the backtest
    baseline. Alert when worse by more than max(0.02, 2 standard errors)."""
    out, alerts = {}, []
    comps = [r["competition_id"] for r in store.q("SELECT DISTINCT m.competition_id FROM predictions p JOIN matches m USING (match_id) WHERE p.log_loss IS NOT NULL")]
    for c in comps:
        lls = [r["log_loss"] for r in store.q(
            """SELECT p.log_loss FROM predictions p JOIN matches m USING (match_id)
               WHERE m.competition_id=? AND p.log_loss IS NOT NULL ORDER BY p.graded_at DESC LIMIT ?""", c, window)]
        n = len(lls)
        mean = sum(lls) / n
        sd = math.sqrt(sum((x - mean) ** 2 for x in lls) / max(n - 1, 1))
        se = sd / math.sqrt(n)
        base = baselines.get(c)
        out[c] = {"n": n, "rolling_log_loss": round(mean, 4), "baseline": base, "se": round(se, 4)}
        if base is not None and n >= 50 and mean > base + max(0.02, 2 * se):
            alerts.append(Alert("accuracy_drop", c, "warning",
                                f"rolling log loss {mean:.3f} over {n} matches vs baseline {base:.3f}"))
    return out, alerts


def check(store: Store, now: float, baselines: dict[str, float] | None = None) -> dict:
    health, a1 = source_health(store, now)
    stale, a2 = stale_results(store, now)
    acc, a3 = accuracy_drop(store, baselines or {})
    unresolved = store.q("SELECT COUNT(*) n FROM unresolved")[0]["n"]
    majors = store.q("SELECT field, COUNT(*) n FROM conflicts WHERE severity='major' GROUP BY field")
    a4 = [Alert("unresolved_ids", "registry", "warning", f"{unresolved} team names need review (registry/unresolved.csv)")] if unresolved else []
    a5 = [Alert("conflicts", r["field"], "info", f"{r['n']} major disagreements on {r['field']} (see conflicts table)") for r in majors]
    fallbacks = store.q("SELECT category, scope, failed_source, used_source, reason, at FROM fallback_events WHERE at > ? ORDER BY id DESC", now - 86400)
    alerts = a1 + a2 + a3 + a4 + a5
    return {
        "generated_at": now,
        "ok": not any(a.severity == "critical" for a in alerts),
        "alerts": [a.as_dict() for a in alerts],
        "sources": health,
        "stale_results": stale,
        "accuracy": acc,
        "fallbacks_last_24h": [dict(r) for r in fallbacks],
    }


def notify(report: dict) -> bool:
    """POST alerts to $MK_ALERT_WEBHOOK (server-side secret) when there are any warnings or worse."""
    url = os.environ.get("MK_ALERT_WEBHOOK")
    serious = [a for a in report["alerts"] if a["severity"] in ("warning", "critical")]
    if not url or not serious:
        return False
    body = json.dumps({"text": "MK Sports data alerts:\n" + "\n".join(f"[{a['severity']}] {a['kind']} {a['subject']}: {a['message']}" for a in serious)}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15):
        return True
