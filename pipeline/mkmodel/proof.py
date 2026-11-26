"""Proof index: which public commit first contained each prediction.

Every pipeline run adds a commit to the repository's `predictions` branch with that run's
football_predictions.json. This script, run right after that commit, records for every prediction version
(match + the moment it was made) the first commit that published it, and writes proof.json next to the
predictions. The app and the public record page link each prediction to that commit, so anyone can open the
file as it was published, before kick-off.

What the record proves, and what it doesn't:
  - The branch is append-only (the workflow never force-pushes it), so every published version stays in the
    history. GitHub's run page for each commit (linked by run number) shows when GitHub ran the job.
  - A commit's own date is written by the committer, so the run page and the push time GitHub shows are the
    stronger evidence. A repository owner could still rewrite the branch; turning on a rule that blocks force
    pushes to `predictions` (Settings > Rules) makes that impossible without first removing the rule.

    python -m mkmodel.proof --site ../site --previous old.json --commit SHA --at ISO --run RUN --repo owner/name
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path

KEEP_DAYS = 60  # entries are dropped this long after kick-off; the branch history keeps everything


def key(match_id: str, made_at: str) -> str:
    return f"{match_id}@{made_at}"


def update(previous: dict, predictions: dict, commit: str, at: str, run: str | None, repo: str) -> dict:
    entries = dict(previous.get("entries", {}))
    added = 0
    for e in list(predictions.get("matches", [])) + list(predictions.get("recent", [])):
        if not e.get("made_at"):
            continue
        k = key(e["match_id"], e["made_at"])
        if k not in entries:
            entries[k] = {"commit": commit, "at": at, "kickoff": e["kickoff"], **({"run": run} if run else {})}
            added += 1
    cutoff = datetime.fromisoformat(at) - timedelta(days=KEEP_DAYS)
    entries = {k: v for k, v in entries.items() if datetime.fromisoformat(v["kickoff"]) >= cutoff}
    return {"schema": 1, "repository": repo, "branch": "predictions", "updated_at": at, "added": added,
            "how_to_check": ("Open the commit: football_predictions.json in it holds the prediction exactly as published. "
                             "The run link shows when GitHub ran the job. The branch is never force-pushed, so its history "
                             "keeps every version."),
            "entries": dict(sorted(entries.items()))}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m mkmodel.proof")
    ap.add_argument("--site", required=True)
    ap.add_argument("--previous", required=True)
    ap.add_argument("--commit", required=True)
    ap.add_argument("--at", required=True, help="the commit's time, ISO 8601")
    ap.add_argument("--run", default=None)
    ap.add_argument("--repo", required=True)
    a = ap.parse_args(argv)
    site = Path(a.site)
    prev_text = Path(a.previous).read_text() if Path(a.previous).exists() else ""
    previous = json.loads(prev_text) if prev_text.strip() else {}
    preds = json.loads((site / "football_predictions.json").read_text())
    doc = update(previous, preds, a.commit, a.at, a.run, a.repo)
    (site / "proof.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    print(json.dumps({"added": doc["added"], "entries": len(doc["entries"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
