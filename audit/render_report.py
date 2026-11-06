"""Render audit/results/<name>.json (from mobile/scripts/audit/backtest.ts) as markdown tables.

    python3 audit/render_report.py audit/results/step1.json > audit/results/step1_tables.md
"""

import json
import sys

LEAGUE_NAMES = {
    "eng.1": "Premier League", "eng.2": "Championship", "esp.1": "LaLiga", "ita.1": "Serie A", "ger.1": "Bundesliga",
    "fra.1": "Ligue 1", "ned.1": "Eredivisie", "por.1": "Liga Portugal", "tur.1": "Süper Lig", "ksa.1": "Saudi Pro League",
    "usa.1": "MLS", "uefa.champions": "Champions League", "uefa.europa": "Europa League", "uefa.europa.conf": "Conference League",
    "eng.fa": "FA Cup", "eng.league_cup": "EFL Cup", "caf.champions": "CAF Champions League", "caf.nations": "AFCON",
    "fifa.world": "World Cup 2026", "fifa.worldq.caf": "WC qualifying (Africa)", "nba": "NBA", "nfl": "NFL", "nhl": "NHL", "mlb": "MLB",
}


def f(x, d=3):
    return "–" if x is None else f"{x:.{d}f}"


def pct(x):
    return "–" if x is None else f"{100 * x:.1f}%"


def main(path):
    r = json.load(open(path))
    t = r["table"]
    out = []
    w = out.append
    w(f"Engine: {r['engine']}. Predictions scored: {r['totals']['matches']:,}. Determinism hash: `{r['predictionHash'][:16]}`.\n")
    for kind in ("sport", "league"):
        w(f"\n### By {kind}: current engine vs benchmarks (all matches)\n")
        w("| | Matches | Model acc | Model log loss | Model Brier | Always-home acc | Home-rate LL | Simple Elo acc | Simple Elo LL | Simple Elo Brier |")
        w("|---|---|---|---|---|---|---|---|---|---|")
        for k, v in t.items():
            if not k.startswith(kind + ":"):
                continue
            name = LEAGUE_NAMES.get(k.split(":", 1)[1], k.split(":", 1)[1])
            m, b, e = v["model"], v["homeRateBaseline"], v["simpleElo"]
            w(f"| {name} | {v['n']:,} | {pct(m['accuracy'])} | {f(m['logLoss'])} | {f(m['brier'])} | {pct(v['alwaysHomeAccuracy'])} | {f(b['logLoss'])} | {pct(e['accuracy'])} | {f(e['logLoss'])} | {f(e['brier'])} |")
        w(f"\n### By {kind}: current engine vs bookmaker closing odds (same matches)\n")
        w("| | Matches with odds | Coverage | Model acc | Bookmaker acc | Model LL | Bookmaker LL | LL gap | Model Brier | Bookmaker Brier | Source |")
        w("|---|---|---|---|---|---|---|---|---|---|---|")
        for k, v in t.items():
            if not k.startswith(kind + ":"):
                continue
            mk = v["market"]
            if not mk["bookmaker"]:
                continue
            name = LEAGUE_NAMES.get(k.split(":", 1)[1], k.split(":", 1)[1])
            a, bk = mk["modelSameMatches"], mk["bookmaker"]
            src = "; ".join(s.replace(" (football-data.co.uk)", "").replace("ESPN core closing ", "ESPN ") for s in mk["sources"][:2])
            w(f"| {name} | {bk['n']:,} | {pct(mk['coverage'])} | {pct(a['accuracy'])} | {pct(bk['accuracy'])} | {f(a['logLoss'])} | {f(bk['logLoss'])} | {f(a['logLoss'] - bk['logLoss'])} | {f(a['brier'])} | {f(bk['brier'])} | {src} |")
    w("\n### Calibration of the current engine, by sport (all outcome probabilities pooled)\n")
    for k, v in t.items():
        if not k.startswith("sport:"):
            continue
        c, cm = v["calibrationModel"], v["calibrationMarket"]
        w(f"\n**{LEAGUE_NAMES.get(k[6:], k[6:])}**: expected calibration error {f(c['ece'])} (bookmaker {f(cm['ece'])})\n")
        w("| Predicted | n | Model said | Happened | Bookmaker said | Happened |")
        w("|---|---|---|---|---|---|")
        for row, mrow in zip(c["rows"], cm["rows"]):
            if not row["n"] and not mrow["n"]:
                continue
            w(f"| {row['bin']} | {row['n']:,} | {pct(row['predicted'])} | {pct(row['observed'])} | {pct(mrow['predicted'])} | {pct(mrow['observed'])} |")
    w("\n### Root-cause measurements\n")
    w("| | Cold-start share (<5 games) | LL warm | LL cold | Cross-league LL model | Cross-league LL bookmaker | LL full history | LL 400-day window | Mean drift 365 vs 400-day window (P home) |")
    w("|---|---|---|---|---|---|---|---|---|")
    for k, v in t.items():
        name = LEAGUE_NAMES.get(k.split(":", 1)[1], k.split(":", 1)[1])
        cl = v["crossLeague"]
        w(f"| {name} | {pct(v['coldShare'])} | {f((v['warm'] or {}).get('logLoss'))} | {f((v['cold'] or {}).get('logLoss'))} | {f((cl['modelSame'] or {}).get('logLoss'))} | {f((cl['market'] or {}).get('logLoss'))} | {f(v['modelFullHistory']['logLoss'])} | {f(v['modelWindow400']['logLoss'])} | {pct(v['windowDrift400vs365'])} |")
    w("\nWindow-start shift (history window starting 7 days later, same match):\n")
    for s, x in r["notes"]["windowShift"].items():
        w(f"- {s}: mean |ΔP(home)| {pct(x['meanAbsDeltaHome'])}, 90th pct {pct(x['p90'])}, max {pct(x['max'])}, favourite flips {pct(x['favouriteFlips'])} (n={x['sampled']})")
    w("\nDraws (football):\n")
    for k, v in t.items():
        if v.get("drawPicks") and k.startswith("sport:"):
            d = v["drawPicks"]
            w(f"- engine picks a draw as the most likely result in {pct(d['modelPicksDraw'])} of matches; draws happened in {pct(d['actualDraws'])}; mean draw probability {pct(d['meanModelDrawProb'])}")
    w("\nMean Elo by domestic league at the end of the data (every team starts at 1500):\n")
    for l, v in sorted(r["eloMeans"].get("football", {}).items(), key=lambda x: -x[1]):
        w(f"- {LEAGUE_NAMES.get(l, l)}: {v:.0f}")
    w("\nfootball-data.co.uk matching:\n")
    for l, v in r["notes"]["footballDataMatching"].items():
        w(f"- {LEAGUE_NAMES.get(l, l)}: {v['matched']:,} of {v['fdRows']:,} rows matched to ESPN matches")
    print("\n".join(out))


if __name__ == "__main__":
    main(sys.argv[1])
