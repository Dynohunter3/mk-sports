"""football-data.co.uk CSVs: results, match stats, pre-closing and closing 1X2 odds, next-round odds."""

from __future__ import annotations

import csv
import io

from ..timeutil import fd_preclosing_collected_at, local_kickoff, parse_dmy, result_available_at, season_of, split_season_code
from .base import Adapter, FetchResult, Unsupported, mkey

BASE = "https://www.football-data.co.uk"
# bookmaker label -> CSV column prefix (pre-closing); closing adds "C" (e.g. PSCH)
BOOKS = {"pinnacle": "PS", "market_avg": "Avg", "market_max": "Max", "bet365": "B365"}
STAT_COLS = {"shots": ("HS", "AS"), "shots_on_target": ("HST", "AST"), "corners": ("HC", "AC"), "fouls": ("HF", "AF"),
             "yellow": ("HY", "AY"), "red": ("HR", "AR")}


def _num(s: str | None) -> float | None:
    try:
        x = float(s)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return x


def _price(r: dict, col: str) -> float | None:
    x = _num(r.get(col))
    return x if x and x > 1.0 else None


def parse_csv(text: str) -> list[dict]:
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    if not rows:
        return []
    head = [h.strip() for h in rows[0]]
    return [dict(zip(head, r)) for r in rows[1:] if any(c.strip() for c in r)]


class FootballDataUK(Adapter):
    name = "footballdata_uk"

    def code(self, comp_id: str) -> str | None:
        c = self.comps.get(comp_id, {})
        return c.get("footballdata_uk") or c.get("footballdata_uk_extra")

    def _url(self, comp_id: str, season: str) -> str:
        c = self.comps[comp_id]
        if c.get("footballdata_uk"):
            return f"{BASE}/mmz4281/{split_season_code(season)}/{c['footballdata_uk']}.csv"
        if c.get("footballdata_uk_extra"):
            return f"{BASE}/new/{c['footballdata_uk_extra']}.csv"
        raise Unsupported(comp_id)

    def fetch_season(self, comp_id: str, season: str, *, max_age: float | None = 6 * 3600) -> FetchResult:
        if not self.covers(comp_id):
            raise Unsupported(comp_id)
        r = self._get(self._url(comp_id, season), max_age=max_age)
        rows = parse_csv(r.text())
        if self.comps[comp_id].get("footballdata_uk_extra"):
            league = self.comps[comp_id]["name"]
            rows = [x for x in rows if x.get("League") == league and x.get("Season", "").split("/")[0] == season]
        return self.parse_rows(comp_id, rows, r.fetched_at, season=season)

    def fetch_upcoming(self, comp_ids: list[str]) -> FetchResult:
        r = self._get(f"{BASE}/fixtures.csv", max_age=3 * 3600)
        code_to_comp = {self.comps[c]["footballdata_uk"]: c for c in comp_ids if self.comps.get(c, {}).get("footballdata_uk")}
        out = FetchResult()
        rows = parse_csv(r.text())
        for comp_id in set(code_to_comp.values()):
            mine = [x for x in rows if code_to_comp.get(x.get("Div")) == comp_id]
            out.extend(self.parse_rows(comp_id, mine, r.fetched_at, live=True))
        return out

    def parse_rows(self, comp_id: str, rows: list[dict], fetched_at: float, live: bool = False, season: str | None = None) -> FetchResult:
        """``season``: the season of the file the rows came from (a season can run past 1 July, e.g. 2019-20)."""
        comp = self.comps[comp_id]
        sport = comp["sport"]
        out = FetchResult()
        for x in rows:
            home, away = (x.get("HomeTeam") or x.get("Home") or "").strip(), (x.get("AwayTeam") or x.get("Away") or "").strip()
            if not home or not away or not x.get("Date"):
                continue
            d = parse_dmy(x["Date"])
            kick, exact = local_kickoff(d, x.get("Time") or None, "Europe/London")
            if live and kick <= fetched_at:
                continue  # the fixtures list can lag: a match that has kicked off is not an upcoming fixture
            hg, ag = x.get("FTHG", x.get("HG", "")), x.get("FTAG", x.get("AG", ""))
            final = hg.strip() != "" and ag.strip() != ""
            row_season = season or season_of(d, comp["seasons"])
            skey = f"{self.code(comp_id)}:{d.isoformat()}:{home}:{away}"
            out.matches.append({
                "source": self.name, "source_key": skey, "competition_id": comp_id, "season": row_season,
                "kickoff_utc": kick, "kickoff_exact": int(exact), "local_date": d.isoformat(),
                "home_raw": home, "away_raw": away, "status": "final" if final else "scheduled",
                "home_score": int(float(hg)) if final else None, "away_score": int(float(ag)) if final else None,
                "fetched_at": fetched_at,
                "available_at": result_available_at(kick, exact, sport) if final else fetched_at,
            })
            key = mkey(self.name, skey)
            for book, p in BOOKS.items():
                for kind, cols in (("pre", (f"{p}H", f"{p}D", f"{p}A")), ("closing", (f"{p}CH", f"{p}CD", f"{p}CA"))):
                    h, dr, a = (_price(x, c) for c in cols)
                    if not (h and dr and a):
                        continue
                    if live:
                        kind_, avail = ("current", fetched_at) if kind == "pre" else ("closing", kick)
                    else:
                        kind_, avail = kind, (fd_preclosing_collected_at(kick) if kind == "pre" else kick)
                    if kind_ == "closing" and not final and live:
                        continue  # a 'closing' column on an unplayed match is not closing yet
                    out.odds.append({"match_key": key, "source": self.name, "bookmaker": book, "kind": kind_,
                                     "home": h, "draw": dr, "away": a, "available_at": avail, "fetched_at": fetched_at})
            if final:
                for side, i in (("home", 0), ("away", 1)):
                    st: dict = {}
                    for k, cols in STAT_COLS.items():
                        v = _num(x.get(cols[i]))
                        if v is not None:
                            st[k] = int(v)
                    if x.get("Referee"):
                        st["referee"] = x["Referee"].strip()
                    if st:
                        out.stats.append({"match_key": key, "side": side, "source": self.name, "stats": st,
                                          "available_at": result_available_at(kick, exact, sport), "fetched_at": fetched_at})
        return out

    def health(self) -> tuple[bool, str]:
        try:
            self._get(f"{BASE}/fixtures.csv", max_age=0, use_cache=False)
            return True, "fixtures.csv reachable"
        except Exception as e:  # noqa: BLE001
            return False, str(e)

