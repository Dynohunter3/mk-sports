"""Player photo index (mkdata/photos.py): matching rules, crop geometry and an end-to-end run on scripted
Wikidata/Commons answers. OpenCV is not needed here; the face crop is replaced by a stub."""

import json

from conftest import FakeClock, FakeTransport
from mkdata import photos
from mkdata.http import HttpClient


def test_person_sim_needs_the_surname_for_a_partial_match():
    assert photos.person_sim("Bukayo Saka", "Bukayo Saka") == 1.0
    assert photos.person_sim("Kylian Mbappé", "Kylian Mbappe") == 1.0
    assert photos.person_sim("Son Heung-Min", "Son Heung-min") == 1.0
    assert photos.person_sim("Rodri", "Rodri") == 1.0
    assert photos.person_sim("Adam Smith", "Adam Duda") == 0.0  # same first name only
    assert photos.person_sim("Keane Lewis-Potter", "Luca Lewis") == 0.0
    assert photos.person_sim("Alexis Mac Allister", "Alexis Mac Allister") == 1.0
    assert 0.5 <= photos.person_sim("Bruno Miguel Borges Fernandes", "Bruno Fernandes") <= 1.0


def test_pick_player_refuses_ties_and_weak_matches():
    c = [("Q1", "Gabriel Jesus"), ("Q2", "Gabriel Martinelli"), ("Q3", "Gabriel Magalhães")]
    assert photos.pick_player("Gabriel Martinelli", c) == "Q2"
    assert photos.pick_player("Gabriel", c) is None  # matches all three equally
    assert photos.pick_player("Adam Smith", [("Q9", "Adam Duda")]) is None
    assert photos.pick_player("Jurriën Timber", [("Q4", "Jurriën Timber"), ("Q5", "Quinten Timber")]) == "Q4"


def test_licences():
    for ok in ["CC BY-SA 4.0", "CC BY 2.0", "CC0", "Public domain", "CC BY-SA 3.0 de"]:
        assert photos.licence_ok(ok), ok
    for bad in ["", None, "GFDL", "Fair use", "CC BY-NC 2.0", "All rights reserved"]:
        assert not photos.licence_ok(bad), bad


def test_face_choice_and_crop_box():
    assert photos.pick_face([], 500, 600) is None
    assert photos.pick_face([(100, 100, 120, 120), (300, 120, 110, 110)], 500, 600) is None  # two similar faces
    assert photos.pick_face([(100, 100, 120, 120), (300, 120, 30, 30)], 500, 600) == (100, 100, 120, 120)
    assert photos.pick_face([(10, 10, 20, 20)], 500, 600) is None  # too small
    x0, y0, side = photos.crop_box(500, 600, (200, 100, 100, 100))
    assert side == 220 and 0 <= x0 <= 500 - side and 0 <= y0 <= 600 - side
    assert x0 < 200 < x0 + side and y0 < 100 < y0 + side  # the face is inside
    x0, y0, side = photos.crop_box(300, 300, (0, 0, 200, 200))
    assert (x0, y0, side) == (0, 0, 300)  # clamped to the image


def _row(q, name, dob, img, espn=None, lang="en"):
    r = {"p": {"value": f"http://www.wikidata.org/entity/{q}"}, "dob": {"value": f"{dob}T00:00:00Z"},
         "img": {"value": f"http://commons.wikimedia.org/wiki/Special:FilePath/{img}"}}
    r["pen" if lang == "en" else "pmul"] = {"value": name}
    if espn:
        r["espn"] = {"value": espn}
    return r


def test_parse_candidates():
    rows = [_row("Q1", "Bukayo Saka", "2001-09-05", "Bukayo%20Saka%202024.jpg", "296466"),
            _row("Q1", "Bukayo Saka", "2001-09-05", "Saka_2026.jpg", lang="mul"),
            _row("Q2", "No Date", "", "x.jpg"),
            {"p": {"value": "http://www.wikidata.org/entity/Q3"}, "dob": {"value": "1999-01-01T00:00:00Z"}, "img": {"value": "y.jpg"}}]
    p = photos.parse_candidates(rows)
    assert set(p) == {"Q1"}
    assert p["Q1"]["files"] == {"Bukayo Saka 2024.jpg", "Saka 2026.jpg"} and p["Q1"]["espn"] == "296466" and p["Q1"]["dob"] == "2001-09-05"


class FakeWdqs:
    def __init__(self, answers):
        self.answers = answers  # list of rows lists, or an Exception
        self.requests = 0
        self.queries = []

    def query(self, sparql):
        self.requests += 1
        self.queries.append(sparql)
        a = self.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a


def _commons(files):
    pages = []
    for title, year, lic in files:
        pages.append({"title": f"File:{title}", "imageinfo": [{
            "thumburl": f"https://upload.wikimedia.org/thumb/{title.replace(' ', '_')}/500px.jpg",
            "extmetadata": {"DateTimeOriginal": {"value": f"{year}-05-01"}, "Artist": {"value": "<a href='x'>Jane Photo</a>"},
                            "LicenseShortName": {"value": lic}, "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0"}}}]})
    return json.dumps({"query": {"pages": pages}})


def test_run_end_to_end(tmp_path):
    clubs = [{"c": {"value": "http://www.wikidata.org/entity/Q9617"}}]
    players = [_row("Q1", "Bukayo Saka", "2001-09-05", "Saka%202024.jpg", "296466"),
               _row("Q1", "Bukayo Saka", "2001-09-05", "Saka%202019.jpg", "296466"),
               _row("Q2", "Declan Rice", "1999-01-14", "Rice.jpg"),
               _row("Q3", "Non Free", "2000-02-02", "Nonfree.jpg")]
    # the third answer: Wikidata facts for the players with a photo (mkdata/wikifacts.py)
    facts = [{"p": {"value": "http://www.wikidata.org/entity/Q1"}, "h": {"value": "1.78"}, "club": {"value": "http://www.wikidata.org/entity/QA"},
              "clubL": {"value": "Arsenal F.C."}, "start": {"value": "2018-01-01T00:00:00Z"}}]
    wd = FakeWdqs([clubs, players, facts])
    clock = FakeClock()
    t = FakeTransport({
        "https://commons.wikimedia.org/": [(200, _commons([("Saka 2024.jpg", 2024, "CC BY-SA 4.0"), ("Saka 2019.jpg", 2019, "CC BY 2.0"),
                                                          ("Rice.jpg", 2023, "CC0"), ("Nonfree.jpg", 2022, "Fair use")]), {})],
        "https://upload.wikimedia.org/": [(200, b"\xff\xd8\xff fake jpeg", {})],
    })
    http = HttpClient(transport=t, clock=clock, sleep=clock.sleep)
    rep = photos.run(http, tmp_path, wdqs=wd, crop=lambda body: (b"JPEG" + body[-4:], "ok"), verify=lambda b: True, now=1_800_000_000, clock=clock)

    pub = tmp_path / "public"
    meta = json.loads((pub / "meta.json").read_text())
    assert meta["players"] == 2 and meta["months"] == ["1999-01", "2001-09"]
    saka = json.loads((pub / "d" / "2001-09.json").read_text())["p"]["2001-09-05"][0]
    assert saka[:3] == ["Q1", "Bukayo Saka", "296466"] and saka[4] == "Jane Photo" and saka[5] == "CC BY-SA 4.0" and saka[6] == 2024
    assert json.loads((pub / "espn.json").read_text())["p"]["296466"][0] == "Q1"
    assert "Q3" not in json.loads((pub / "credits.json").read_text())["c"]  # not a free licence
    assert (tmp_path / "i" / "Q1.jpg").exists() and (tmp_path / "i" / "Q2.jpg").exists()
    # the newest photo was used, and only one download per player
    assert json.loads((tmp_path / "index.json").read_text())["players"]["Q1"]["crop"]["file"] == "Saka 2024.jpg"
    assert sum(1 for u, _ in t.calls if "upload.wikimedia.org" in u) == 2
    assert rep["players_with_photo"] == 2 and rep["cropped"] == 2
    assert rep["players_with_facts"] == 1 and json.loads((pub / "f" / "Q1.json").read_text())["h"] == 178

    # a second run the same day asks Wikidata nothing and downloads nothing
    wd2 = FakeWdqs([])
    calls = len(t.calls)
    photos.run(http, tmp_path, wdqs=wd2, crop=lambda body: (b"JPEG", "ok"), verify=lambda b: True, now=1_800_000_000 + 3600, clock=clock)
    assert wd2.requests == 0 and len(t.calls) == calls


def test_budget_and_rate_limit_continue_next_run(tmp_path):
    clubs = [{"c": {"value": "http://www.wikidata.org/entity/Q9617"}}]
    players = [_row(f"Q{i}", f"Player Number{i}", f"199{i}-01-01", f"P{i}.jpg", espn=str(100 + i)) for i in range(1, 6)]
    clock = FakeClock()
    t = FakeTransport({
        "https://commons.wikimedia.org/": [(200, _commons([(f"P{i}.jpg", 2025, "CC0") for i in range(1, 6)]), {})],
        "https://upload.wikimedia.org/": [(200, b"\xff\xd8\xff x", {})],
    })
    http = HttpClient(transport=t, clock=clock, sleep=clock.sleep)
    crop = lambda body: (b"JPEG", "ok")  # noqa: E731
    rep = photos.run(http, tmp_path, wdqs=FakeWdqs([clubs, players]), crop=crop, verify=lambda b: True, budget=2, now=1_800_000_000, clock=clock)
    assert rep["players_with_photo"] == 2
    rep = photos.run(http, tmp_path, wdqs=FakeWdqs([]), crop=crop, verify=lambda b: True, budget=10, now=1_800_000_100, clock=clock)
    assert rep["players_with_photo"] == 5

    # the query service says 429: the saved candidates are kept and nothing is lost
    rep = photos.run(http, tmp_path, wdqs=FakeWdqs([photos.RateLimited("429")]), crop=crop, verify=lambda b: True, now=1_800_000_000 + 2 * 86400, clock=clock)
    assert rep["players_with_photo"] == 5 and rep["wdqs_rate_limited"] == 1


def test_no_face_is_remembered_and_not_retried(tmp_path):
    clubs = [{"c": {"value": "http://www.wikidata.org/entity/Q9617"}}]
    players = [_row("Q7", "Crowd Shot", "1998-03-03", "Crowd.jpg")]
    clock = FakeClock()
    t = FakeTransport({
        "https://commons.wikimedia.org/": [(200, _commons([("Crowd.jpg", 2025, "CC BY 4.0")]), {})],
        "https://upload.wikimedia.org/": [(200, b"\xff\xd8\xff x", {})],
    })
    http = HttpClient(transport=t, clock=clock, sleep=clock.sleep)
    photos.run(http, tmp_path, wdqs=FakeWdqs([clubs, players]), crop=lambda b: (None, "no-face"), verify=lambda b: True, now=1_800_000_000, clock=clock)
    idx = json.loads((tmp_path / "index.json").read_text())
    assert idx["players"]["Q7"]["status"] == "no-face"
    n = len(t.calls)
    photos.run(http, tmp_path, wdqs=FakeWdqs([]), crop=lambda b: (None, "no-face"), verify=lambda b: True, now=1_800_000_100, clock=clock)
    assert len(t.calls) == n


def test_truncated_wikidata_answer_is_a_failed_chunk_not_a_crash(tmp_path):
    w = photos.Wdqs(gap=0, post=lambda url, data, headers, timeout: (200, b'{"results": {"bindings": [{"p": {"value": "htt', {}))
    try:
        w.query("SELECT 1")
        raise AssertionError("expected FetchError")
    except photos.FetchError as e:
        assert "truncated" in str(e)


def test_crops_made_before_the_check_are_verified_again_and_bad_ones_withdrawn(tmp_path):
    clubs = [{"c": {"value": "http://www.wikidata.org/entity/Q9617"}}]
    players = [_row("Q1", "Real Face", "2001-01-01", "Face.jpg", "1"), _row("Q2", "Grass Shot", "2002-02-02", "Grass.jpg", "2")]
    clock = FakeClock()
    t = FakeTransport({
        "https://commons.wikimedia.org/": [(200, _commons([("Face.jpg", 2025, "CC0"), ("Grass.jpg", 2025, "CC0")]), {})],
        "https://upload.wikimedia.org/": [(200, b"\xff\xd8\xff x", {})],
    })
    http = HttpClient(transport=t, clock=clock, sleep=clock.sleep)
    photos.run(http, tmp_path, wdqs=FakeWdqs([clubs, players]), crop=lambda b: (b"JPEG", "ok"), verify=lambda b: True, now=1_800_000_000, clock=clock)
    idx = json.loads((tmp_path / "index.json").read_text())
    for q in ("Q1", "Q2"):  # pretend these were made by an older version, before the check
        del idx["players"][q]["crop"]["check"]
    (tmp_path / "index.json").write_text(json.dumps(idx))
    (tmp_path / "i" / "Q2.jpg").write_bytes(b"GRASS")
    rep = photos.run(http, tmp_path, wdqs=FakeWdqs([]), crop=lambda b: (None, "unverified"), verify=lambda b: b != b"GRASS",
                     now=1_800_000_100, clock=clock)
    assert rep["crops_withdrawn"] == 1 and rep["players_with_photo"] == 1
    assert not (tmp_path / "i" / "Q2.jpg").exists()
    assert json.loads((tmp_path / "public" / "credits.json").read_text())["c"].keys() == {"Q1"}
