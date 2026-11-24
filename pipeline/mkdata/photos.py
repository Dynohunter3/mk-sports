"""Player photos for the app from Wikimedia Commons, matched through Wikidata.

Why: the app's match data source (ESPN) has photos for very few current players. Measured on
24 Nov 2026: 38 of the 605 players in Premier League squads (6%), some of them years old.

Sources (both free to reuse; neither needs a key):
* Wikidata (CC0 public domain): footballers' dates of birth, photos (P18) and, where editors have
  added it, ESPN FC player ID (P3681).
* Wikimedia Commons: the photos themselves, under free licences. Only CC0, public domain, CC BY
  and CC BY-SA are accepted. Each photo is published with its author and licence.

Per the source registry, ESPN's terms forbid automated extraction, so this job never fetches ESPN.
Wikidata's club memberships are often out of date (a player's latest transfer is often missing), but
dates of birth are not, so the index is keyed by date of birth. The phone already reads each team's
squad from ESPN, birth dates included (ordinary app use). It matches by ESPN ID where Wikidata has
one, otherwise by birth date and name.

Who is included: footballers born in 1986 or later, with a photo, who have played for a club in one of
LEAGUES. A club counts if Wikidata gives it that league, or lists it in one of that league's seasons
since 2022.

Each run is incremental and polite:
1. Candidates: Wikidata queries (the club list, then players in chunks of clubs), refreshed at most
   once a day. The query service is paced to one request a minute, its limit at times. A failed
   chunk keeps its last saved answer.
2. Metadata: Commons image info (author, licence, date taken, a 500 px thumbnail) for new files,
   50 per request.
3. Crops: download the thumbnail, find the face (OpenCV), cut a square around it and save it as a
   160 px JPEG. Done within a per-run budget: players with an ESPN ID first, then the youngest.
4. Publish into `public/`:
   - `meta.json`;
   - `d/<yyyy-mm>.json`: players by birth month;
   - `espn.json`;
   - `credits.json`.

   The images are in `i/<player>.jpg`.

Wikimedia's robot policy (wikitech.wikimedia.org/wiki/Robot_policy, read 24 Nov 2026) is followed:
* a User-Agent with contact details;
* gzip for API calls;
* the Action API one request at a time, 5 s apart;
* media one at a time (the limit is 2), standard thumbnail sizes only;
* Retry-After honoured on a 429.

A second 429 or an outage ends that phase for this run; the next run continues where this one stopped.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from .http import Blocked, FetchError, HttpClient

log = logging.getLogger("mkdata.photos")

# Wikimedia User-Agent policy: client name/version, contact (a website is accepted), "bot" in the name, then the library
UA = "MKSportsPhotoBot/1.0 (https://github.com/Dynohunter3/mk-sports; football player photos for the MK Sports app) Python-urllib/3"
WDQS = "https://query.wikidata.org/sparql"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"

# (app competition slug, Wikidata league): players who have played for these leagues' clubs are included
LEAGUES: list[tuple[str, str]] = [
    ("eng.1", "Q9448"), ("esp.1", "Q324867"), ("ita.1", "Q15804"), ("ger.1", "Q82595"), ("fra.1", "Q13394"),
    ("eng.2", "Q19510"), ("por.1", "Q182994"), ("ned.1", "Q167541"), ("tur.1", "Q485568"), ("ksa.1", "Q255633"),
    ("usa.1", "Q18543"), ("bel.1", "Q216022"), ("sco.1", "Q14377162"), ("egy.1", "Q680619"), ("zam.1", "Q145554"),
]
BORN_FROM = "1986-01-01"
CLUB_CHUNK = 30  # big clubs have thousands of former players; smaller chunks keep each query light

THUMB_PX = 500  # a standard Wikimedia thumbnail width
OUT_PX = 160  # the app draws photos at up to 88 px; 160 px is sharp at 52 px on 3x screens
CANDIDATES_MAX_AGE = 20 * 3600
WDQS_GAP = 61.0
COMMONS_GAP = 5.0  # robot policy, Action API unauthenticated: 1 at a time, and 5 s after a slow request
IMAGE_GAP = 1.0  # robot policy, media: at most 2 at a time and 25 Mbps; we fetch one 500 px thumbnail a second
PRUNE_AFTER = 120 * 86400

FREE = re.compile(r"^(cc0|cc[- ]zero|public domain|pd\b|pdm\b|cc by(-sa)? \d(\.\d)?\b)", re.I)


class RateLimited(Exception):
    pass


# ---------------------------------------------------------------- names (mirrored in mobile/src/data/photos.ts)
def person_tokens(s: str) -> list[str]:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return [w for w in re.sub(r"[^a-z]+", " ", s).split() if w]


def person_sim(a: str, b: str) -> float:
    """1 for the same name; for a partial match the surnames must agree; otherwise 0."""
    x, y = person_tokens(a), person_tokens(b)
    if not x or not y:
        return 0.0
    if "".join(x) == "".join(y):
        return 1.0
    sx, sy = set(x), set(y)
    s = len(sx & sy) / min(len(sx), len(sy))
    if s >= 0.999:
        return 1.0
    return s if x[-1] == y[-1] else 0.0


def pick_player(name: str, candidates: list[tuple[str, str]]) -> str | None:
    """candidates: (key, name). The single best match scoring at least 0.5, or None if tied or too weak."""
    scored = sorted(((person_sim(name, n), k) for k, n in candidates), reverse=True)
    if not scored or scored[0][0] < 0.5:
        return None
    if len(scored) > 1 and scored[1][0] == scored[0][0] and scored[1][1] != scored[0][1]:
        return None
    return scored[0][1]


def licence_ok(short_name: str | None) -> bool:
    return bool(short_name and FREE.match(short_name.strip()))


# ---------------------------------------------------------------- face crop
def pick_face(faces: list[tuple[int, int, int, int]], w: int, h: int) -> tuple[int, int, int, int] | None:
    """The largest face, unless a second face is nearly as large (a group photo: whose face is it?)
    or it is too small to give a sharp crop."""
    fs = sorted(faces, key=lambda f: -(f[2] * f[3]))
    if not fs:
        return None
    big = fs[0]
    if len(fs) > 1 and fs[1][2] >= 0.75 * big[2]:
        return None
    if big[2] < 0.07 * w:
        return None
    return big


def crop_box(w: int, h: int, face: tuple[int, int, int, int], zoom: float = 2.2) -> tuple[int, int, int] | None:
    """Square (x0, y0, side) around the face, a little lower than centre so the chin and collar show."""
    fx, fy, fw, fh = face
    side = min(int(round(fw * zoom)), w, h)
    if side < 64:
        return None
    cx = fx + fw / 2
    cy = fy + fh / 2 + fh * 0.15
    x0 = int(round(cx - side / 2))
    y0 = int(round(cy - side / 2))
    x0 = max(0, min(x0, w - side))
    y0 = max(0, min(y0, h - side))
    return x0, y0, side


_cascade = None


def face_crop_jpeg(body: bytes) -> tuple[bytes | None, str]:
    """(jpeg, "ok") or (None, reason). OpenCV is imported here so the rest of the module needs only the standard library."""
    global _cascade
    import cv2  # opencv-python-headless (requirements-photos.txt)
    import numpy as np

    img = cv2.imdecode(np.frombuffer(body, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None, "bad-image"
    h, w = img.shape[:2]
    if _cascade is None:
        _cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    gray = cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    m = max(24, int(min(w, h) * 0.06))
    faces = [tuple(int(v) for v in f) for f in _cascade.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=6, minSize=(m, m))]
    face = pick_face(faces, w, h)
    if not face:
        return None, "no-face"
    box = crop_box(w, h, face)
    if not box:
        return None, "too-small"
    x0, y0, side = box
    crop = img[y0 : y0 + side, x0 : x0 + side]
    interp = cv2.INTER_AREA if side >= OUT_PX else cv2.INTER_CUBIC
    out = cv2.resize(crop, (OUT_PX, OUT_PX), interpolation=interp)
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 82, cv2.IMWRITE_JPEG_PROGRESSIVE, 1, cv2.IMWRITE_JPEG_OPTIMIZE, 1])
    return (buf.tobytes(), "ok") if ok else (None, "encode")


# ---------------------------------------------------------------- Wikidata
CLUBS_QUERY = """SELECT DISTINCT ?c WHERE {
  VALUES ?league { %(leagues)s }
  { ?c wdt:P118 ?league } UNION { ?season wdt:P3450 ?league ; wdt:P1923 ?c ; wdt:P580 ?s . FILTER(?s >= "2022-01-01T00:00:00Z"^^xsd:dateTime) }
  MINUS { ?c wdt:P31 wd:Q5 }  # players carry a league too
}"""

PLAYERS_QUERY = """SELECT ?p ?pen ?pmul ?dob ?img ?espn WHERE {
  VALUES ?c { %(clubs)s }
  ?p wdt:P54 ?c ; wdt:P18 ?img ; wdt:P569 ?dob .
  FILTER(?dob >= "%(born)sT00:00:00Z"^^xsd:dateTime)
  OPTIONAL { ?p wdt:P3681 ?espn }
  OPTIONAL { ?p rdfs:label ?pen FILTER(LANG(?pen)="en") }
  OPTIONAL { ?p rdfs:label ?pmul FILTER(LANG(?pmul)="mul") }
}"""


def clubs_query(leagues=None) -> str:
    return CLUBS_QUERY % {"leagues": " ".join(f"wd:{q}" for _, q in (leagues or LEAGUES))}


def players_query(clubs: list[str]) -> str:
    return PLAYERS_QUERY % {"clubs": " ".join(f"wd:{c}" for c in clubs), "born": BORN_FROM}


class Wdqs:
    """Wikidata Query Service over POST (long queries), at most one request per `gap` seconds."""

    def __init__(self, gap: float = WDQS_GAP, clock: Callable[[], float] = time.time, sleep: Callable[[float], None] = time.sleep,
                 post: Callable[[str, bytes, dict, float], tuple[int, bytes, dict]] | None = None):
        self.gap, self.clock, self.sleep = gap, clock, sleep
        self.post = post or _urllib_post
        self.last: float | None = None
        self.requests = 0

    def query(self, sparql: str) -> list[dict]:
        if self.last is not None:
            wait = self.last + self.gap - self.clock()
            if wait > 0:
                self.sleep(wait)
        self.last = self.clock()
        self.requests += 1
        data = urllib.parse.urlencode({"query": sparql, "format": "json"}).encode()
        status, body, _ = self.post(WDQS, data, {"User-Agent": UA, "Accept": "application/sparql-results+json", "Accept-Encoding": "gzip",
                                                 "Content-Type": "application/x-www-form-urlencoded"}, 120.0)
        body = _gunzip(body)
        if status == 429:
            raise RateLimited("Wikidata query service: 429")
        if status != 200:
            raise FetchError(WDQS, status or None, "query failed")
        try:
            return json.loads(body)["results"]["bindings"]
        except (ValueError, KeyError, TypeError):
            # the service can time out mid-answer and still send 200 with the JSON cut off
            raise FetchError(WDQS, status, "truncated answer") from None


def _urllib_post(url: str, data: bytes, headers: dict, timeout: float) -> tuple[int, bytes, dict]:
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read() if e.fp else b"", dict(e.headers or {})
    except OSError as e:
        return 0, str(e).encode(), {}


def _gunzip(body: bytes) -> bytes:
    return gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body


def _qid(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def _file(uri: str) -> str:
    """Commons file title from a Special:FilePath URI."""
    return urllib.parse.unquote(uri.rsplit("/", 1)[-1]).replace("_", " ")


def parse_candidates(rows: list[dict]) -> dict:
    """WDQS rows -> {qid: {name, dob (yyyy-mm-dd), espn, files: set}}; rows without a usable name or date are skipped."""
    players: dict[str, dict] = {}
    for r in rows:
        name = (r.get("pen") or r.get("pmul") or {}).get("value")
        dob = r.get("dob", {}).get("value", "")[:10]
        if not name or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dob):
            continue
        q = _qid(r["p"]["value"])
        p = players.setdefault(q, {"name": name, "dob": dob, "espn": "", "files": set()})
        if r.get("pen"):
            p["name"] = r["pen"]["value"]  # prefer the English label
        p["files"].add(_file(r["img"]["value"]))
        if "espn" in r and re.fullmatch(r"\d+", r["espn"]["value"]):
            p["espn"] = r["espn"]["value"]
    return players


# ---------------------------------------------------------------- the job
@dataclass
class Paths:
    root: Path

    @property
    def index(self) -> Path:
        return self.root / "index.json"

    @property
    def candidates(self) -> Path:
        return self.root / "candidates.json"

    def image(self, qid: str) -> Path:
        return self.root / "i" / f"{qid}.jpg"

    @property
    def public(self) -> Path:
        return self.root / "public"


def _load(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def _save(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    tmp.replace(path)


def _strip_html(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def refresh_candidates(wdqs: Wdqs, paths: Paths, now: float, stats: Counter, leagues=None) -> dict:
    """{chunk index: rows}, refreshed at most once a day; each chunk keeps its last good answer."""
    saved = _load(paths.candidates, {"clubs_at": 0, "clubs": [], "chunks": {}})
    try:
        if now - saved.get("clubs_at", 0) >= CANDIDATES_MAX_AGE or not saved["clubs"]:
            clubs = sorted({_qid(r["c"]["value"]) for r in wdqs.query(clubs_query(leagues))})
            if clubs:
                saved["clubs"], saved["clubs_at"] = clubs, now
                stats["clubs"] = len(clubs)
        chunks = [saved["clubs"][i : i + CLUB_CHUNK] for i in range(0, len(saved["clubs"]), CLUB_CHUNK)]
        for i, chunk in enumerate(chunks):
            key = hashlib.sha1(" ".join(chunk).encode()).hexdigest()[:10]
            old = saved["chunks"].get(key)
            if old and now - old["at"] < CANDIDATES_MAX_AGE:
                continue
            try:
                rows = wdqs.query(players_query(chunk))
            except FetchError as e:
                log.warning("photos: player chunk %d/%d failed (%s); keeping its last answer", i + 1, len(chunks), e)
                stats["chunk_errors"] += 1
                continue
            saved["chunks"][key] = {"at": now, "rows": rows}
            stats["chunks_refreshed"] += 1
            _save(paths.candidates, saved)
        live = {hashlib.sha1(" ".join(c).encode()).hexdigest()[:10] for c in chunks}
        saved["chunks"] = {k: v for k, v in saved["chunks"].items() if k in live}
    except RateLimited as e:
        log.warning("photos: %s; candidates continue next run", e)
        stats["wdqs_rate_limited"] += 1
    except FetchError as e:
        log.warning("photos: club list not refreshed (%s)", e)
        stats["clubs_errors"] += 1
    _save(paths.candidates, saved)
    return saved


def run(http: HttpClient, root: Path, *, budget: int = 1200, max_seconds: float = 2400, leagues=None,
        wdqs: Wdqs | None = None, crop: Callable[[bytes], tuple[bytes | None, str]] = face_crop_jpeg,
        now: float | None = None, clock: Callable[[], float] = time.time, only: set[str] | None = None) -> dict:
    """One incremental pass. `only`: Wikidata ids to describe and crop (a targeted run, e.g. for a preview)."""
    paths = Paths(root)
    now = now if now is not None else clock()
    start = clock()
    wdqs = wdqs or Wdqs()
    idx = _load(paths.index, {"files": {}, "players": {}})
    stats: Counter = Counter()

    # 1. candidates
    saved = refresh_candidates(wdqs, paths, now, stats, leagues)
    found = parse_candidates([r for ch in saved["chunks"].values() for r in ch["rows"]])
    for q, p in found.items():
        cur = idx["players"].setdefault(q, {})
        cur.update({"name": p["name"], "dob": p["dob"], "espn": p["espn"], "files": sorted(p["files"]), "seen": now})
    stats["candidates"] = len(found)
    # players with an ESPN ID first (Wikidata editors add it for notable players), then the youngest
    order = sorted(found, key=lambda q: (found[q]["espn"] == "", found[q]["dob"] > "2008", [-ord(ch) for ch in found[q]["dob"]]))
    if only is not None:
        order = [q for q in order if q in only]

    # 2. Commons metadata for files we have not seen, in the same order
    want = list(dict.fromkeys(f for q in order for f in sorted(found[q]["files"]) if f not in idx["files"]))
    for i in range(0, len(want), 50):
        if clock() - start > max_seconds:
            break
        batch = want[i : i + 50]
        url = COMMONS_API + "?" + urllib.parse.urlencode({
            "action": "query", "titles": "|".join("File:" + f for f in batch), "prop": "imageinfo",
            "iiprop": "extmetadata|size|url", "iiurlwidth": str(THUMB_PX), "format": "json", "formatversion": "2",
            "iiextmetadatafilter": "DateTimeOriginal|Artist|LicenseShortName|LicenseUrl", "maxlag": "5"})
        try:
            r = http.get(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"}, check_robots=False, use_cache=False, min_interval=COMMONS_GAP)
            d = json.loads(_gunzip(r.body))
        except (Blocked, FetchError, ValueError) as e:
            log.warning("photos: Commons metadata stopped for this run (%s)", e)
            stats["commons_errors"] += 1
            break
        norm = {n["to"]: n["from"] for n in d.get("query", {}).get("normalized", [])}
        for pg in d.get("query", {}).get("pages", []):
            title = pg.get("title", "")
            f = norm.get(title, title).split(":", 1)[-1]
            ii = (pg.get("imageinfo") or [{}])[0]
            em = ii.get("extmetadata", {})
            taken = _strip_html(em.get("DateTimeOriginal", {}).get("value", ""))
            yr = re.search(r"(19|20)\d\d", taken)
            idx["files"][f] = {
                "thumb": ii.get("thumburl") or "",
                "artist": _strip_html(em.get("Artist", {}).get("value", ""))[:90] or "Unknown author",
                "licence": _strip_html(em.get("LicenseShortName", {}).get("value", "")),
                "lu": em.get("LicenseUrl", {}).get("value", ""),
                "year": int(yr.group()) if yr else None,
                "page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
            }
            stats["files_described"] += 1
    _save(paths.index, idx)

    # 3. crops within the budget
    done = 0
    for q in order:
        if done >= budget or clock() - start > max_seconds or stats["image_errors"] >= 5:
            break
        p = idx["players"][q]
        files = [f for f in p["files"] if f in idx["files"] and licence_ok(idx["files"][f]["licence"]) and idx["files"][f]["thumb"]]
        if not files:
            if p["files"] and all(f in idx["files"] for f in p["files"]):
                p["status"] = "licence"
            continue
        files.sort(key=lambda f: (idx["files"][f]["year"] or 0, f), reverse=True)  # newest dated photo first
        tried = p.setdefault("tried", {})
        current = p.get("crop", {}).get("file")
        if current and current in files and all(f in tried for f in files[: files.index(current)]):
            continue  # cropped from the newest photo that has a usable face
        for f in files:
            if f in tried:
                if f == current:
                    break
                continue
            body = _download(http, idx["files"][f]["thumb"], stats)
            done += 1
            if body is None:
                break
            jpeg, why = crop(body)
            tried[f] = why
            if jpeg:
                paths.image(q).parent.mkdir(parents=True, exist_ok=True)
                paths.image(q).write_bytes(jpeg)
                p["crop"] = {"file": f, "ver": hashlib.sha1(jpeg).hexdigest()[:8]}
                stats["cropped"] += 1
                break
            stats[f"crop_{why}"] += 1
        p["status"] = "ok" if p.get("crop") else (next(reversed(tried.values())) if tried else "pending")
    stats["downloads"] = done
    _save(paths.index, idx)

    # 4. forget players not seen as candidates for a long time
    for q in [q for q, p in idx["players"].items() if now - p.get("seen", 0) > PRUNE_AFTER]:
        paths.image(q).unlink(missing_ok=True)
        del idx["players"][q]
    _save(paths.index, idx)

    report = publish(idx, paths, now)
    report.update(dict(stats))
    report["wdqs_requests"] = wdqs.requests
    report["seconds"] = round(clock() - start)
    _save(root / "report.json", report)
    return report


def _download(http: HttpClient, url: str, stats: Counter) -> bytes | None:
    """The thumbnail; if its host is refused, the same path on upload.wikimedia.org (the canonical media host)."""
    url = url.split("?", 1)[0]
    alt = re.sub(r"^https://thumb\.wikimedia\.org/", "https://upload.wikimedia.org/", url)
    for u in dict.fromkeys([url, alt]):
        try:
            r = http.get(u, headers={"User-Agent": UA}, check_robots=False, use_cache=False, min_interval=IMAGE_GAP)
            if r.body[:3] == b"\xff\xd8\xff" or r.body[:8] == b"\x89PNG\r\n\x1a\n" or r.body[:4] == b"RIFF":
                return r.body
            stats["image_not_image"] += 1
        except Blocked as e:
            if e.status == 429:
                stats["image_errors"] = 99  # rate limited: no more downloads this run
                return None
            stats["image_blocked"] += 1
        except FetchError:
            stats["image_errors"] += 1
    return None


def publish(idx: dict, paths: Paths, now: float) -> dict:
    """meta.json, d/<yyyy-mm>.json, espn.json and credits.json; returns coverage figures for the report."""
    pub = paths.public
    (pub / "d").mkdir(parents=True, exist_ok=True)
    months: dict[str, dict[str, list]] = {}
    espn: dict[str, list] = {}
    credits: dict[str, list] = {}
    years: list[int] = []
    for q, p in sorted(idx["players"].items()):
        cr = p.get("crop")
        if not cr or not paths.image(q).exists() or not p.get("dob"):
            continue
        f = idx["files"].get(cr["file"], {})
        row = [q, p["name"], p.get("espn", ""), cr["ver"], f.get("artist", ""), f.get("licence", ""), f.get("year")]
        months.setdefault(p["dob"][:7], {}).setdefault(p["dob"], []).append(row)
        if p.get("espn"):
            espn[p["espn"]] = [q, cr["ver"], f.get("artist", ""), f.get("licence", ""), f.get("year")]
        credits[q] = [p["name"], f.get("artist", ""), f.get("licence", ""), f.get("lu", ""), f.get("page", ""), f.get("year")]
        if f.get("year"):
            years.append(f["year"])
    for m, days in months.items():
        _save(pub / "d" / f"{m}.json", {"v": 1, "p": days})
    for old in (pub / "d").glob("*.json"):
        if old.stem not in months:
            old.unlink()
    stamp = datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="seconds")
    _save(pub / "espn.json", {"v": 1, "p": espn})
    _save(pub / "credits.json", {"v": 1, "updated": stamp, "c": credits})
    _save(pub / "meta.json", {"v": 1, "updated": stamp, "source": "Wikidata + Wikimedia Commons", "players": len(credits),
                              "months": sorted(months)})
    years.sort()
    return {"updated": stamp, "players_with_photo": len(credits), "with_espn_id": len(espn),
            "median_photo_year": years[len(years) // 2] if years else None,
            "photos_2024_or_later": sum(y >= 2024 for y in years),
            "status": dict(Counter(p.get("status", "pending") for p in idx["players"].values()))}
