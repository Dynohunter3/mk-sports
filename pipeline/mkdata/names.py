"""Team-name normalisation and similarity (used only as evidence; IDs come from mkdata.ids)."""

from __future__ import annotations

import re
import unicodedata

STOP = {
    "fc", "cf", "afc", "sc", "ac", "as", "cd", "ud", "rc", "rcd", "sd", "club", "calcio", "fk", "sk", "bk",
    "sv", "vfb", "vfl", "tsg", "de", "la", "the", "and", "ssc", "us", "ca", "ogc", "stade", "cp", "sl",
    "krc", "bsc", "1", "04", "05", "1899", "1846", "1907", "1909", "1913", "1919",
}
# Short forms used by football-data.co.uk and others -> the word that appears in full names.
EXPAND = {
    "man": "manchester", "utd": "united", "nottm": "nottingham", "wolves": "wolverhampton",
    "spurs": "tottenham", "qpr": "queens", "sp": "sporting", "st": "saint", "int": "internazionale",
    "inter": "internazionale", "ein": "eintracht", "mgladbach": "monchengladbach", "gladbach": "monchengladbach",
    "psg": "paris", "sheff": "sheffield", "wed": "wednesday", "brighton": "brighton", "leverkusen": "leverkusen",
    "bayern": "bayern", "munich": "munchen", "dortmund": "dortmund", "nijmegen": "nec", "psv": "psv",
}


def tokens(name: str) -> list[str]:
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("&", " and ").replace("'", "")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    out = []
    for w in s.split():
        w = EXPAND.get(w, w)
        if w and w not in STOP and not w.isdigit():
            out.append(w)
    return out


def norm_key(name: str) -> str:
    return " ".join(tokens(name))


def similarity(a: str, b: str) -> float:
    """Token overlap in [0, 1]; a 4-letter prefix counts as a match (Atl/Atletico, Leverkusen/Bayer Leverkusen)."""
    x, y = tokens(a), tokens(b)
    if not x or not y:
        return 0.0
    if "".join(x) == "".join(y):
        return 1.0
    hits = 0
    for w in x:
        if any(v == w or (len(w) >= 4 and v.startswith(w[:4])) or (len(v) >= 4 and w.startswith(v[:4])) for v in y):
            hits += 1
    return hits / max(len(x), len(y))


def slug(name: str) -> str:
    return "-".join(tokens(name)) or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
