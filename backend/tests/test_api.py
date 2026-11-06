"""API integration tests against the seeded mock world."""

from datetime import timedelta

from sqlalchemy import select

from app.db import utcnow
from app.models import League, Match, Sport, User

API = "/api/v1"


def upcoming_match(db, sport="football", hours=6) -> Match:
    sid = db.scalar(select(Sport.id).where(Sport.slug == sport))
    return db.scalar(
        select(Match).where(Match.sport_id == sid, Match.status == "scheduled", Match.start_time > utcnow() + timedelta(hours=hours)).order_by(Match.start_time)
    )


def test_health_and_meta(client):
    assert client.get("/health").json() == {"status": "ok"}
    meta = client.get(f"{API}/meta").json()
    assert "not betting advice" in meta["disclaimer"] and meta["free_to_play"] is True and meta["shows_odds"] is False


def test_catalog(client):
    sports = client.get(f"{API}/sports").json()
    assert [s["slug"] for s in sports] == ["football", "basketball"]
    assert sports[1]["has_draws"] is False and sports[0]["scoring"]["max_points"] == 5
    everything = client.get(f"{API}/sports", params={"include_inactive": True}).json()
    assert {"cricket", "tennis", "formula1"} <= {s["slug"] for s in everything}
    leagues = client.get(f"{API}/leagues", params={"sport": "football"}).json()
    assert {"premier-league", "champions-league", "zambia-super-league", "caf-champions-league"} <= {lg["slug"] for lg in leagues}
    pl = next(lg for lg in leagues if lg["slug"] == "premier-league")
    table = client.get(f"{API}/leagues/{pl['id']}/standings").json()
    assert len(table) == 20 and table[0]["position"] == 1 and table[0]["points"] >= table[-1]["points"]
    teams = client.get(f"{API}/teams", params={"search": "arsen"}).json()
    assert teams[0]["name"] == "Arsenal" and teams[0]["elo"] is not None


def test_match_list_filters_and_pagination(client):
    page1 = client.get(f"{API}/matches", params={"sport": "basketball", "status": "finished", "order": "desc", "limit": 5}).json()
    assert len(page1["items"]) == 5 and page1["next_cursor"]
    assert all(m["sport"] == "basketball" and m["status"] == "finished" for m in page1["items"])
    page2 = client.get(f"{API}/matches", params={"sport": "basketball", "status": "finished", "order": "desc", "limit": 5, "cursor": page1["next_cursor"]}).json()
    assert not {m["id"] for m in page1["items"]} & {m["id"] for m in page2["items"]}
    assert page2["items"][0]["start_time"] <= page1["items"][-1]["start_time"]
    today = client.get(f"{API}/matches", params={"date": utcnow().date().isoformat(), "tz": "Africa/Lusaka"})
    assert today.status_code == 200
    assert client.get(f"{API}/matches", params={"date": "2026-11-03", "tz": "Mars/Base"}).status_code == 422


def test_live_matches_exist_after_demo_live(client):
    live = client.get(f"{API}/matches/live").json()
    assert any(m["status"] == "live" and m["clock"] for m in live)
    assert all(m["locked"] for m in live)


def test_every_upcoming_match_has_a_prediction(client, db):
    m = upcoming_match(db)
    d = client.get(f"{API}/matches/{m.id}").json()
    p = d["prediction_full"]
    assert abs(sum(p["probabilities"].values()) - 1) < 0.01
    assert p["confidence"] in ("low", "medium", "high")
    assert 3 <= len(p["key_factors"]) <= 5
    assert p["explanation"]["steps"] and p["explanation"]["summary"]
    assert d["prediction"]["pick"] in ("home", "draw", "away")
    for key in ("form", "head_to_head", "standings", "injuries", "venue", "ratings"):
        assert key in d
    bb = client.get(f"{API}/matches/{upcoming_match(db, 'basketball').id}").json()
    assert bb["prediction"]["draw"] is None and "draw" not in bb["prediction_full"]["probabilities"]


def test_etag_returns_304(client, db):
    url = f"{API}/matches/{upcoming_match(db).id}"
    r = client.get(url)
    etag = r.headers["etag"]
    r2 = client.get(url, headers={"If-None-Match": etag})
    assert r2.status_code == 304 and r2.content == b""


def test_feed_guest_and_personalised(client, db, make_user):
    guest = client.get(f"{API}/feed").json()
    assert guest["sections"] and not guest["personalised"]
    nba = db.scalar(select(League).where(League.slug == "nba"))
    personal = client.get(f"{API}/feed", params={"leagues": str(nba.id)}).json()
    assert personal["personalised"]
    today = next((s for s in personal["sections"] if s["key"] == "today"), None)
    if today:
        assert all(m["league"]["slug"] == "nba" for m in today["items"])
    headers, _ = make_user()
    r = client.put(f"{API}/me/favourites", headers=headers, json={"sports": [], "leagues": [nba.id], "teams": []})
    assert r.status_code == 200 and r.json()["onboarded"] is True
    mine = client.get(f"{API}/feed", headers=headers).json()
    assert mine["personalised"]


def test_auth_flow(client, make_user):
    headers, uid = make_user("Auth Person")
    me = client.get(f"{API}/me", headers=headers).json()
    assert me["id"] == uid and me["consented"] and me["stats"]["total_points"] == 0
    assert client.get(f"{API}/me").status_code == 401
    assert client.get(f"{API}/me", headers={"Authorization": "Bearer nope"}).status_code == 401
    bad = client.post(f"{API}/auth/login", json={"email": me["email"], "password": "wrong-password"})
    assert bad.status_code == 401
    ok = client.post(f"{API}/auth/login", json={"email": me["email"], "password": "s3cret-pass"})
    assert ok.status_code == 200
    dup = client.post(f"{API}/auth/register", json={"email": me["email"], "password": "s3cret-pass", "display_name": "Xy", "accept_terms": True, "accept_privacy": True})
    assert dup.status_code == 409
    no_consent = client.post(f"{API}/auth/register", json={"email": "c@example.com", "password": "s3cret-pass", "display_name": "Xy", "accept_terms": False, "accept_privacy": True})
    assert no_consent.status_code == 422
    assert client.post(f"{API}/auth/demo").status_code == 200


def test_consent_required_for_picks(client, db):
    from app.auth import create_dev_token

    u = User(auth_provider="dev", auth_subject="noconsent", email="noconsent@example.com", display_name="NC")
    db.add(u)
    db.commit()
    headers = {"Authorization": f"Bearer {create_dev_token(u)}"}
    m = upcoming_match(db)
    r = client.put(f"{API}/picks/{m.id}", headers=headers, json={"pick": "home"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "consent_required"
    assert client.post(f"{API}/me/consent", headers=headers, json={"terms": True, "privacy": True}).status_code == 200
    assert client.put(f"{API}/picks/{m.id}", headers=headers, json={"pick": "home"}).status_code == 200


def test_pick_lifecycle(client, db, make_user):
    headers, _ = make_user()
    m = upcoming_match(db)
    r = client.put(f"{API}/picks/{m.id}", headers=headers, json={"home_score": 2, "away_score": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pick"] == "home" and body["status"] == "pending" and "first-pick" in body["new_badges"]
    r = client.put(f"{API}/picks/{m.id}", headers=headers, json={"pick": "draw", "home_score": 1, "away_score": 1})
    assert r.json()["pick"] == "draw" and r.json()["new_badges"] == []  # editing keeps one pick per match
    assert client.put(f"{API}/picks/{m.id}", headers=headers, json={"pick": "home", "home_score": 0, "away_score": 1}).json()["detail"]["code"] == "score_mismatch"
    card = client.get(f"{API}/matches/{m.id}", headers=headers).json()
    assert card["my_pick"]["pick"] == "draw"
    mine = client.get(f"{API}/picks", headers=headers, params={"match_ids": str(m.id)}).json()
    assert len(mine) == 1
    hist = client.get(f"{API}/me/picks", headers=headers, params={"status": "pending"}).json()
    assert hist["items"][0]["match"]["id"] == m.id
    assert client.delete(f"{API}/picks/{m.id}", headers=headers).status_code == 204
    assert client.get(f"{API}/picks", headers=headers, params={"match_ids": str(m.id)}).json() == []


def test_no_draw_picks_in_basketball(client, db, make_user):
    headers, _ = make_user()
    m = upcoming_match(db, "basketball")
    r = client.put(f"{API}/picks/{m.id}", headers=headers, json={"pick": "draw"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "no_draws"


def test_picks_lock_at_kickoff(client, db, make_user):
    headers, _ = make_user()
    m = upcoming_match(db, hours=30)
    assert client.put(f"{API}/picks/{m.id}", headers=headers, json={"pick": "away"}).status_code == 200
    original = m.start_time
    m.start_time = utcnow() - timedelta(seconds=1)  # kick-off has passed (status still 'scheduled')
    db.commit()
    try:
        r = client.put(f"{API}/picks/{m.id}", headers=headers, json={"pick": "home"})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "locked"
        assert client.delete(f"{API}/picks/{m.id}", headers=headers).status_code == 409
    finally:
        m.start_time = original
        db.commit()


def test_leaderboards(client, make_user):
    for period in ("week", "season", "all"):
        r = client.get(f"{API}/leaderboards/global", params={"period": period})
        assert r.status_code == 200
        body = r.json()
        ranks = [row["rank"] for row in body["items"]]
        points = [row["points"] for row in body["items"]]
        assert points == sorted(points, reverse=True)
        assert ranks == sorted(ranks)
    season = client.get(f"{API}/leaderboards/global", params={"period": "season"}).json()
    assert season["total"] >= 25  # demo players
    demo = client.post(f"{API}/auth/demo").json()["access_token"]
    me = client.get(f"{API}/leaderboards/global", params={"period": "season"}, headers={"Authorization": f"Bearer {demo}"}).json()["me"]
    assert me and me["is_me"] and me["display_name"] == "You (Demo)"
    periods = client.get(f"{API}/leaderboards/periods").json()
    assert periods["current"]["season"] in periods["available"]["season"]


def test_accuracy_tracker(client):
    acc = client.get(f"{API}/accuracy").json()
    assert acc["overall"]["n"] > 100 and 0.3 < acc["overall"]["hit_rate"] < 0.9
    assert {r["sport"] for r in acc["sports"]} == {"football", "basketball"}
    assert acc["leagues"] and acc["recent"]
    backtest = client.get(f"{API}/accuracy", params={"source": "backtest"}).json()
    assert backtest["overall"]["n"] == acc["overall"]["n"] - client.get(f"{API}/accuracy", params={"source": "live"}).json()["overall"]["n"]


def test_prediction_history_endpoint(client, db):
    m = upcoming_match(db)
    hist = client.get(f"{API}/matches/{m.id}/predictions").json()
    assert hist and hist[0]["version"] == 1


def test_export_and_delete_account(client, db, make_user):
    headers, uid = make_user("Leaving Soon")
    m = upcoming_match(db)
    client.put(f"{API}/picks/{m.id}", headers=headers, json={"pick": "home"})
    export = client.get(f"{API}/me/export", headers=headers).json()
    assert export["profile"]["id"] == uid and len(export["picks"]) == 1
    assert client.delete(f"{API}/me", headers=headers).status_code == 204
    assert client.get(f"{API}/me", headers=headers).status_code == 401
    db.expire_all()
    assert db.get(User, uid) is None


def test_admin_requires_token_and_adds_league(client):
    assert client.post(f"{API}/admin/jobs/settle").status_code == 403
    h = {"X-Admin-Token": "test-admin-token"}
    assert client.post(f"{API}/admin/jobs/settle", headers=h).status_code == 200
    payload = {"leagues": [{"slug": "kenya-premier-league", "sport": "football", "name": "Kenyan Premier League", "short_name": "KPL", "country": "Kenya", "region": "Africa", "provider_refs": {}}]}
    assert client.post(f"{API}/admin/catalog", headers=h, json=payload).status_code == 200
    slugs = {lg["slug"] for lg in client.get(f"{API}/leagues", params={"sport": "football"}).json()}
    assert "kenya-premier-league" in slugs  # new competition, no code change
    bad = {"leagues": [{"slug": "x", "sport": "quidditch", "name": "X"}]}
    assert client.post(f"{API}/admin/catalog", headers=h, json=bad).status_code == 422


def test_feed_etag_is_stable_between_polls(client):
    r1 = client.get(f"{API}/feed")
    r2 = client.get(f"{API}/feed", headers={"If-None-Match": r1.headers["etag"]})
    assert r2.status_code == 304  # polling an unchanged feed costs no body
