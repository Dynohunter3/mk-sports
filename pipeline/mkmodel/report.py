"""Render audit/results/$MK_RUN.json (default step3) as markdown tables.

    python -m mkmodel.report > ../audit/results/step3_tables.md
"""

import json
from pathlib import Path

NAMES = {"eng.1": "Premier League", "eng.2": "Championship", "esp.1": "LaLiga", "ita.1": "Serie A", "ger.1": "Bundesliga",
         "fra.1": "Ligue 1", "ned.1": "Eredivisie", "por.1": "Liga Portugal", "tur.1": "Süper Lig", "usa.1": "MLS",
         "uefa.champions": "Champions League", "all": "All leagues"}
import os

RES = Path(__file__).resolve().parents[2] / "audit" / "results" / f"{os.environ.get('MK_RUN', 'step3')}.json"


def f(x, d=4):
    return "–" if x is None else f"{x:.{d}f}"


def main():
    r = json.loads(RES.read_text())
    res = r["results"]
    out = [f"Evaluation matches: {r['eval_matches']:,}. Seed {r['seed']}. Prediction hash `{r['prediction_hash']}`.\n"]
    out.append("### Feature groups added one at a time (boosted model, selection season 2024-25)\n")
    out.append("| Step | Added | Selection log loss | Selection Brier | Kept |")
    out.append("|---|---|---|---|---|")
    for i, s in enumerate(r["gbm_steps"], 1):
        out.append(f"| {i} | {s['added']} | {f(s['selection_log_loss'])} | {f(s['selection_brier'])} | {'yes' if s['kept'] else 'no'} |")
    for split, title in (("selection", "Selection season (2024-25; MLS 2024)"), ("test", "Test season (2025-26; MLS 2025) — never used for a decision"),
                         ("both", "Both seasons")):
        out.append(f"\n### All models, all leagues — {title}\n")
        out.append("| Model | n | Accuracy | Log loss | Brier | ECE | LL gap to closing odds |")
        out.append("|---|---|---|---|---|---|---|")
        for name, v in res.items():
            a = v.get(split, {}).get("all")
            if a:
                out.append(f"| {name} | {a['n']:,} | {100 * a['accuracy']:.1f}% | {f(a['log_loss'])} | {f(a['brier'])} | {f(a['ece'], 3)} | {f(a.get('ll_gap_to_closing'))} |")
    return out, res, r


def per_league(res, split, before, after):
    out = [f"\n### Per league, {split}: current engine v2 vs `{after}`\n",
           "| League | n | v2 log loss | new log loss | Δ LL | v2 Brier | new Brier | Δ Brier | new acc | new gap to closing | closing LL |",
           "|---|---|---|---|---|---|---|---|---|---|---|"]
    b, a = res[before][split], res[after][split]
    close = res["bookmaker closing"][split]
    for lg in sorted(a, key=lambda k: (k == "all", k)):
        if lg not in b:
            continue
        x, y = b[lg], a[lg]
        c = close.get(lg)
        out.append(f"| {NAMES.get(lg, lg)} | {y['n']:,} | {f(x['log_loss'])} | {f(y['log_loss'])} | {y['log_loss'] - x['log_loss']:+.4f} | "
                   f"{f(x['brier'])} | {f(y['brier'])} | {y['brier'] - x['brier']:+.4f} | {100 * y['accuracy']:.1f}% | "
                   f"{f(y.get('ll_gap_to_closing'))} | {f(c['log_loss']) if c else '–'} |")
    return out


if __name__ == "__main__":
    import sys

    out, res, r = main()
    best = sys.argv[1] if len(sys.argv) > 1 else "ensemble (no market) + calibration"
    for split in ("selection", "test", "both"):
        out += per_league(res, split, "current engine v2", best)
    out.append("\n### Calibration (both seasons, all outcome probabilities pooled)\n")
    for name, rows in r["calibration"].items():
        out.append(f"\n**{name}**\n\n| Predicted | n | Mean predicted | Observed |\n|---|---|---|---|")
        out += [f"| {x['bin']} | {x['n']:,} | {100 * x['predicted']:.1f}% | {100 * x['observed']:.1f}% |" for x in rows]
    print("\n".join(out))
