"""Backtest CLI.

    predictpro-backtest results.csv --sport football [--warmup 200]

CSV columns: date (ISO 8601), home, away, home_score, away_score, [competition], [neutral]
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime

from .evaluation import backtest, should_promote
from .registry import get_model
from .types import FinishedMatch


def load_csv(path: str) -> list[FinishedMatch]:
    out = []
    with open(path, newline="", encoding="utf-8") as fh:
        for i, row in enumerate(csv.DictReader(fh)):
            out.append(
                FinishedMatch(
                    id=row.get("id") or str(i),
                    date=datetime.fromisoformat(row["date"]),
                    home=row["home"],
                    away=row["away"],
                    home_score=int(row["home_score"]),
                    away_score=int(row["away_score"]),
                    competition=row.get("competition") or "default",
                    neutral=(row.get("neutral") or "").lower() in ("1", "true", "yes"),
                )
            )
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv")
    ap.add_argument("--sport", required=True)
    ap.add_argument("--warmup", type=int, default=100, help="matches used only for training at the start")
    ap.add_argument("--params", default="{}", help="JSON model parameter overrides")
    args = ap.parse_args(argv)
    model = get_model(args.sport, json.loads(args.params))
    result = backtest(model, load_csv(args.csv), warmup=args.warmup)
    ok, reasons = should_promote(result.model, result.baseline, min_matches=1)
    print(json.dumps({**result.to_dict(), "beats_baseline": ok, "notes": reasons}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
