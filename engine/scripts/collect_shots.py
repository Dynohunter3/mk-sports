"""Collect every shot (with pitch coordinates) from real finished matches in ESPN's public feed.

    python engine/scripts/collect_shots.py OUT.jsonl [--per-league 120]

For each competition the script lists the last 12 months of finished matches (one scoreboard
request per calendar year), then reads each match summary, whose play-by-play commentary
carries the type, team, text and field position of every attempt. One JSON line per shot.
Used by fit_xg.py to fit the on-device expected-goals model.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import random
import ssl
import time
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer"
LEAGUES = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "uefa.champions", "eng.2"]
SHOT_TYPES = {"shot-off-target", "shot-on-target", "shot-blocked", "shot-hit-woodwork", "goal", "penalty---scored", "penalty---missed", "penalty---saved"}

_ctx = ssl.create_default_context()


def get(url: str, tries: int = 4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"Accept-Encoding": "identity", "User-Agent": "mk-sports-research/1.0"})
            with urllib.request.urlopen(req, timeout=40, context=_ctx) as r:
                return json.loads(r.read())
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 ** i)


def finished_ids(slug: str) -> list[str]:
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=365)
    ids = []
    for year in sorted({start.year, now.year}):
        data = get(f"{BASE}/{slug}/scoreboard?dates={year}&limit=1000")
        for e in data.get("events", []):
            d = datetime.fromisoformat(e["date"].replace("Z", "+00:00"))
            st = e.get("status", {}).get("type", {})
            if start <= d <= now and st.get("state") == "post" and st.get("completed"):
                ids.append(e["id"])
    return ids


def shots_of(slug: str, event_id: str) -> list[dict]:
    d = get(f"{BASE}/{slug}/summary?event={event_id}")
    out = []
    for c in d.get("commentary", []):
        p = c.get("play")
        if not p:
            continue
        t = p.get("type", {}).get("type", "")
        if t not in SHOT_TYPES or p.get("shootout"):
            continue
        out.append(
            {
                "league": slug,
                "event": event_id,
                "type": t,
                "team": p.get("team", {}).get("displayName"),
                "x": p.get("fieldPositionX"),
                "y": p.get("fieldPositionY"),
                "x2": p.get("fieldPosition2X"),
                "y2": p.get("fieldPosition2Y"),
                "period": p.get("period", {}).get("number"),
                "text": p.get("text", ""),
            }
        )
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--per-league", type=int, default=120)
    a = ap.parse_args()
    random.seed(7)
    jobs = []
    for slug in LEAGUES:
        ids = finished_ids(slug)
        random.shuffle(ids)
        jobs += [(slug, i) for i in ids[: a.per_league]]
        print(slug, len(ids), "finished, sampling", min(len(ids), a.per_league), flush=True)
    n = 0
    with open(a.out, "w") as f, cf.ThreadPoolExecutor(4) as ex:
        futs = {ex.submit(shots_of, s, i): (s, i) for s, i in jobs}
        for k, fut in enumerate(cf.as_completed(futs)):
            try:
                for shot in fut.result():
                    f.write(json.dumps(shot) + "\n")
                    n += 1
            except Exception as e:  # one bad summary shouldn't stop the run
                print("skip", futs[fut], e, flush=True)
            if k % 50 == 0:
                print(f"{k}/{len(jobs)} matches, {n} shots", flush=True)
    print("done", n, "shots from", len(jobs), "matches", flush=True)


if __name__ == "__main__":
    main()
