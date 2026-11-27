"""Player facts from Wikidata (CC0) for the players in the photo index: height, place of birth and senior career.

The photo index already ties each player to a Wikidata item. This adds what ESPN's feed does not carry, for the
app's player page, with Wikidata credited there. Queries go through the same polite client as the photos (one
query a minute, a User-Agent with contact details), a few chunks per run, each player refreshed every two weeks.

Wikidata is edited by volunteers and is sometimes wrong or out of date, so the facts are cleaned before publishing:
  - only senior clubs and the senior national team (youth sides are left out);
  - a club spell that overlaps the next one ends when the next one starts (a common slip: an end date typed as the
    year the player left the next club), unless it was a loan;
  - an end date recorded as "unknown" is shown as unknown, never as "still there";
  - heights outside 1.50-2.10 m are dropped.
Club captains were also tried and rejected: Wikidata's captain statements are missing or years out of date for
most clubs (Step notes in docs/RELEASE_2_4.md).

    published: photos/f/<wikidata id>.json   {"v": 1, "h": 186, "born": "Székesfehérvár", "clubs": [...], "nt": [...]}
"""
from __future__ import annotations

import json
import logging
import re
from collections import Counter
from pathlib import Path

log = logging.getLogger("mkdata.wikifacts")

CHUNK = 250  # players per query
MAX_AGE = 14 * 86400
YOUTH = re.compile(r"\b(under[- ]?\d\d|u-?\d\d|youth|junior|academy|olympic)\b", re.I)
LOAN = "Q2914547"  # "loan" as an acquisition transaction (P1642)
NT_SUFFIX = re.compile(r"\s+(men's\s+)?national(\s+association)?\s+football\s+team$", re.I)
CLUB_SUFFIX = re.compile(r"\s+A?\.?F\.C\.$")  # "Liverpool F.C." -> "Liverpool", as the app names clubs elsewhere

FACTS_QUERY = """SELECT ?p ?h ?pobL ?club ?clubL ?start ?end ?acq ?nt WHERE {
  VALUES ?p { %(players)s }
  OPTIONAL { ?p p:P2048/psn:P2048/wikibase:quantityAmount ?h }
  OPTIONAL { ?p wdt:P19 ?pob . ?pob rdfs:label ?pobL FILTER(LANG(?pobL)="en") }
  OPTIONAL { ?p p:P54 ?st . ?st ps:P54 ?club .
             OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end } OPTIONAL { ?st pq:P1642 ?acq }
             OPTIONAL { ?club wdt:P31 wd:Q6979593 . BIND(1 AS ?nt) }
             OPTIONAL { ?club rdfs:label ?clubL FILTER(LANG(?clubL)="en") } }
}"""


def facts_query(qids: list[str]) -> str:
    return FACTS_QUERY % {"players": " ".join(f"wd:{q}" for q in qids)}


def _qid(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def _year(v: dict | None) -> int | None | str:
    """A year, None when absent, or "?" for an "unknown value" (a blank node)."""
    if not v:
        return None
    s = v.get("value", "")
    if "/.well-known/genid/" in s or v.get("type") == "bnode":
        return "?"
    m = re.match(r"(-?\d{4})-", s)
    return int(m.group(1)) if m else None


def parse_facts(rows: list[dict]) -> dict[str, dict]:
    """WDQS rows -> {qid: {"h": cm | None, "born": str | None, "clubs": [[label, start, end, loan]], "nt": [label, since] | None}}."""
    raw: dict[str, dict] = {}
    for r in rows:
        q = _qid(r["p"]["value"])
        p = raw.setdefault(q, {"h": set(), "born": set(), "spells": {}})
        if "h" in r:
            try:
                p["h"].add(round(float(r["h"]["value"]) * 100))
            except ValueError:
                pass
        if "pobL" in r:
            p["born"].add(r["pobL"]["value"])
        if "club" in r and "clubL" in r:
            key = (r["club"]["value"], r.get("start", {}).get("value"))
            s = p["spells"].setdefault(key, {"label": r["clubL"]["value"], "start": _year(r.get("start")), "end": _year(r.get("end")), "loan": False, "nt": False})
            if r.get("acq") and _qid(r["acq"]["value"]) == LOAN:
                s["loan"] = True
            if r.get("nt"):
                s["nt"] = True
    out = {}
    for q, p in raw.items():
        h = sorted(p["h"])
        height = h[len(h) // 2] if h and 150 <= h[len(h) // 2] <= 210 else None
        born = sorted(p["born"])[0] if len(p["born"]) == 1 else None  # two different places: leave it out
        spells = [s for s in p["spells"].values() if not YOUTH.search(s["label"]) and isinstance(s["start"], int)]
        clubs = sorted([s for s in spells if not s["nt"] and "national" not in s["label"].lower()], key=lambda s: (s["start"], s["label"]))
        # a permanent spell ends by the time the next permanent one starts (loans in between overlap by design)
        permanent = [s for s in clubs if not s["loan"]]
        for a, b in zip(permanent, permanent[1:]):
            if isinstance(a["end"], int) and a["end"] > b["start"]:
                a["end"] = b["start"]
            if a["end"] is None:
                a["end"] = "?"  # an open spell followed by another club cannot still be running
        nts = sorted([s for s in spells if s["nt"] or ("national" in s["label"].lower() and "football team" in s["label"].lower())], key=lambda s: s["start"])
        nt = [NT_SUFFIX.sub("", nts[-1]["label"]) or nts[-1]["label"], nts[-1]["start"]] if nts and nts[-1]["end"] is None else None
        out[q] = {"h": height, "born": born, "clubs": [[CLUB_SUFFIX.sub("", s["label"]), s["start"], s["end"], 1 if s["loan"] else 0] for s in clubs], "nt": nt}
    return out


def refresh(wdqs, root: Path, now: float, qids: list[str], stats: Counter, max_chunks: int = 6) -> dict:
    """Refresh the oldest players' facts, `max_chunks` queries at most; returns {qid: {"at", "f"}}."""
    path = root / "facts.json"
    saved = json.loads(path.read_text()) if path.exists() else {}
    stale = sorted([q for q in qids if q not in saved or now - saved[q]["at"] >= MAX_AGE], key=lambda q: saved.get(q, {}).get("at", 0))
    for i in range(0, min(len(stale), max_chunks * CHUNK), CHUNK):
        chunk = stale[i : i + CHUNK]
        try:
            rows = wdqs.query(facts_query(chunk))
        except Exception as e:  # noqa: BLE001 - a failed query keeps the last good facts and stops this run's refresh
            log.warning("wikifacts: query failed (%s); continuing next run", e)
            stats["facts_errors"] += 1
            break
        found = parse_facts(rows)
        for q in chunk:
            saved[q] = {"at": now, "f": found.get(q, {"h": None, "born": None, "clubs": [], "nt": None})}
        stats["facts_refreshed"] += len(chunk)
        path.write_text(json.dumps(saved, ensure_ascii=False))
    return saved


def publish(public: Path, saved: dict, published: set[str]) -> int:
    """photos/f/<qid>.json for players in the published photo index; returns how many have any fact."""
    out = public / "f"
    out.mkdir(parents=True, exist_ok=True)
    n = 0
    for q in published:
        f = saved.get(q, {}).get("f")
        if not f or not (f["h"] or f["born"] or f["clubs"] or f["nt"]):
            (out / f"{q}.json").unlink(missing_ok=True)
            continue
        (out / f"{q}.json").write_text(json.dumps({"v": 1, "src": "Wikidata", **f}, ensure_ascii=False, separators=(",", ":")))
        n += 1
    for old in out.glob("*.json"):
        if old.stem not in published:
            old.unlink()
    return n
