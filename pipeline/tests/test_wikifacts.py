"""Wikidata player facts: parsing and cleaning (pipeline/mkdata/wikifacts.py)."""
import json
from collections import Counter

from mkdata import wikifacts as W

E = "http://www.wikidata.org/entity/"


def row(q="Q1", club=None, label=None, start=None, end=None, h=None, pob=None, acq=None, nt=False):
    r = {"p": {"value": E + q}}
    if h:
        r["h"] = {"value": h}
    if pob:
        r["pobL"] = {"value": pob}
    if club:
        r["club"] = {"value": E + club}
        r["clubL"] = {"value": label}
        if start:
            r["start"] = {"value": f"{start}-01-01T00:00:00Z"}
        if end == "unknown":
            r["end"] = {"type": "bnode", "value": "http://www.wikidata.org/.well-known/genid/abc"}
        elif end:
            r["end"] = {"value": f"{end}-07-01T00:00:00Z"}
        if acq:
            r["acq"] = {"value": E + acq}
        if nt:
            r["nt"] = {"value": "1"}
    return r


def test_career_is_cleaned():
    rows = [
        row(club="Q1387293", label="FC Liefering", start=2017, end=2018, h="1.86", pob="Székesfehérvár"),
        row(club="Q994811", label="FC Red Bull Salzburg", start=2018, end=2023, h="1.86", pob="Székesfehérvár"),  # wrong end
        row(club="Q702455", label="RB Leipzig", start=2021, end=2023, h="1.86", pob="Székesfehérvár"),
        row(club="Q1130849", label="Liverpool F.C.", start=2023, h="1.86", pob="Székesfehérvár"),
        row(club="Q385222", label="Hungary national under-21 football team", start=2017, end=2018, h="1.86", pob="Székesfehérvár"),
        row(club="Q170561", label="Hungary men's national football team", start=2019, nt=True, h="1.86", pob="Székesfehérvár"),
    ]
    f = W.parse_facts(rows)["Q1"]
    assert f["h"] == 186 and f["born"] == "Székesfehérvár"
    assert [c[0] for c in f["clubs"]] == ["FC Liefering", "FC Red Bull Salzburg", "RB Leipzig", "Liverpool"]  # trailing F.C. dropped
    assert f["clubs"][1][2] == 2021  # clipped to Leipzig's start
    assert f["clubs"][3][2] is None  # still there
    assert f["nt"] == ["Hungary", 2019]


def test_loans_unknown_ends_and_bad_values():
    rows = [
        row(club="QA", label="Club A", start=2015, end=2020, h="2.45"),
        row(club="QB", label="Club B", start=2017, end=2018, acq=W.LOAN, h="2.45"),  # a loan inside a spell
        row(club="QC", label="Club C", start=2020, end="unknown", h="2.45"),
        row(club="QD", label="Hungary men's national football team", start=2014, end="unknown", nt=True, h="2.45"),
    ]
    f = W.parse_facts(rows)["Q1"]
    assert f["h"] is None  # 2.45 m is not a footballer's height
    assert f["clubs"][0][2] == 2020 and f["clubs"][1][3] == 1  # the loan does not clip the parent spell
    assert f["clubs"][2][2] == "?"  # an unknown end stays unknown
    assert f["nt"] is None  # an unknown end is never shown as current
    two = W.parse_facts([row(pob="A"), row(pob="B")])["Q1"]
    assert two["born"] is None


class FakeWdqs:
    def __init__(self, rows):
        self.rows, self.calls = rows, 0

    def query(self, sparql):
        self.calls += 1
        return self.rows


def test_refresh_and_publish(tmp_path):
    wd = FakeWdqs([row(club="QA", label="Club A", start=2020, h="1.80")])
    stats = Counter()
    saved = W.refresh(wd, tmp_path, 1_000_000.0, ["Q1", "Q2"], stats)
    assert wd.calls == 1 and stats["facts_refreshed"] == 2
    W.refresh(wd, tmp_path, 1_000_000.0 + 3600, ["Q1", "Q2"], stats)
    assert wd.calls == 1  # fresh: nothing to do
    pub = tmp_path / "public"
    n = W.publish(pub, saved, {"Q1", "Q2"})
    assert n == 1 and json.loads((pub / "f" / "Q1.json").read_text())["clubs"][0][0] == "Club A"
    assert not (pub / "f" / "Q2.json").exists()  # nothing known
    W.publish(pub, saved, {"Q2"})
    assert not (pub / "f" / "Q1.json").exists()  # no longer in the photo index


def test_overlap_is_clipped_across_a_loan():
    rows = [
        row(club="QB", label="Villarreal CF B", start=2019, end=2022),
        row(club="QM", label="CD Mirandés", start=2020, end=2021, acq=W.LOAN),
        row(club="QV", label="Villarreal CF", start=2021, end=2023),
        row(club="QS", label="Senegal men's national association football team", start=2022, nt=True),
    ]
    f = W.parse_facts(rows)["Q1"]
    assert f["clubs"][0][2] == 2021  # clipped to the next permanent club, past the loan
    assert f["clubs"][1][3] == 1 and f["clubs"][1][2] == 2021
    assert f["nt"] == ["Senegal", 2022]
