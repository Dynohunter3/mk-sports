"""Generate fixtures that the TypeScript port (mobile/src/engine) must reproduce."""
import json, sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from predictpro_engine import Absence, BasketballModel, FootballModel, backtest  # noqa: E402
from tests.helpers import simulate_basketball_league, simulate_football_league  # noqa: E402


def mjson(m):
    return {"id": m.id, "date": m.date.isoformat(), "home": m.home, "away": m.away, "homeScore": m.home_score, "awayScore": m.away_score, "competition": m.competition, "neutral": m.neutral}


def pjson(p):
    return {"probHome": p.prob_home, "probDraw": p.prob_draw, "probAway": p.prob_away, "predictedHome": p.predicted_home, "predictedAway": p.predicted_away,
            "expectedHome": p.expected_home, "expectedAway": p.expected_away, "confidence": p.confidence, "factors": [f.text for f in p.key_factors], "summary": p.explanation["summary"]}


out = {}
for sport, model, (matches, _), queries in [
    ("football", FootballModel(), simulate_football_league(16, 2), [
        dict(home="T00", away="T01"), dict(home="T05", away="T09", neutral=True),
        dict(home="T03", away="T07", away_absences=[Absence("K. Mensah", "FWD", 1.0, "injured", "top_scorer"), Absence("J. Silva", "GK", 0.6, "suspended")]),
        dict(home="T12", away="T02", home_absences=[Absence("A. B", "MID", 0.7, "doubtful")]), dict(home="T14", away="T15"), dict(home="NEW", away="T01"),
    ]),
    ("basketball", BasketballModel(), simulate_basketball_league(cycles=6), [
        dict(home="B00", away="B01"), dict(home="B02", away="B03", neutral=True),
        dict(home="B06", away="B07", home_absences=[Absence("A. Star", "F", 1.0, "injured", "star")]), dict(home="B10", away="B11", hours=24), dict(home="B12", away="B13", hours=96),
    ]),
]:
    book = model.new_book()
    book.update_many(matches)
    preds = []
    for q in queries:
        hours = q.pop("hours", 72)
        kick = book.last_date + timedelta(hours=hours)
        inp = book.build_input(q["home"], q["away"], kick, matches[0].competition, q.get("neutral", False), q.get("home_absences", ()), q.get("away_absences", ()), f"Team {q['home']}", f"Team {q['away']}")
        p = model.predict(inp)
        preds.append({"query": {**{k: v for k, v in q.items() if "absences" not in k}, "kickoff": kick.isoformat(),
                                "homeAbsences": [a.__dict__ for a in q.get("home_absences", ())], "awayAbsences": [a.__dict__ for a in q.get("away_absences", ())]},
                      "expected": pjson(p)})
    res = backtest(model, matches, warmup=100)
    out[sport] = {"matches": [mjson(m) for m in matches], "predictions": preds, "elo": dict(book.ratings_table()[:5]),
                  "backtest": {"model": res.model.to_dict()}}
Path(sys.argv[1]).write_text(json.dumps(out))
print("written", {k: (len(v["matches"]), len(v["predictions"])) for k, v in out.items()})
