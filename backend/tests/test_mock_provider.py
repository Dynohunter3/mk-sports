from collections import Counter
from datetime import datetime, timedelta, timezone

from app.providers.base import LeagueRef
from app.providers.mock import FOOTBALL_REAL_MINUTES, MockProvider, circle_rounds

ANCHOR = datetime(2026, 7, 27, tzinfo=timezone.utc)  # a Monday
PL = LeagueRef("football", "premier-league", "eng-pl")
NBA = LeagueRef("basketball", "nba", "nba")


def provider(now: datetime, **kw) -> MockProvider:
    return MockProvider(ANCHOR, seed=7, clock=lambda: now, **kw)


def test_circle_rounds_is_a_valid_round_robin():
    teams = [f"t{i}" for i in range(20)]
    rounds = circle_rounds(teams)
    assert len(rounds) == 19
    pairs = Counter()
    for r in rounds:
        playing = [t for p in r for t in p]
        assert len(playing) == len(set(playing)) == 20  # everyone plays exactly once per round
        pairs.update(frozenset(p) for p in r)
    assert len(pairs) == 190 and set(pairs.values()) == {1}  # every pair meets once
    homes = Counter(h for r in rounds for h, _ in r)
    assert max(homes.values()) - min(homes.values()) <= 1  # home games balanced
    first8 = Counter(h for r in rounds[:8] for h, _ in r)
    assert set(first8.values()) == {4}  # e.g. UCL league phase: 4 home, 4 away


def test_fixtures_are_deterministic():
    now = ANCHOR + timedelta(days=60)
    a = provider(now).fetch_fixtures(PL, ANCHOR, ANCHOR + timedelta(days=30))
    b = provider(now).fetch_fixtures(PL, ANCHOR, ANCHOR + timedelta(days=30))
    assert [(m.ref, m.home_score, m.away_score) for m in a] == [(m.ref, m.home_score, m.away_score) for m in b]
    assert len(a) == 40  # 4 weekly rounds of 10 matches
    assert all(m.status == "finished" and m.home_score is not None for m in a)


def test_past_finished_future_scheduled():
    now = ANCHOR + timedelta(days=30, hours=6)
    ms = provider(now).fetch_fixtures(PL, now - timedelta(days=10), now + timedelta(days=10))
    assert {m.status for m in ms if m.start_time + timedelta(minutes=FOOTBALL_REAL_MINUTES) < now} == {"finished"}
    future = [m for m in ms if m.start_time > now]
    assert future and all(m.status == "scheduled" and m.home_score is None for m in future)


def test_live_match_progresses_and_finishes():
    base = provider(ANCHOR + timedelta(days=60))
    m = base.fetch_fixtures(PL, ANCHOR + timedelta(days=5), ANCHOR + timedelta(days=6))[0]
    final = (m.home_score, m.away_score)
    seen = []
    for minutes in (10, 40, 55, 80, 105, 130):
        live = provider(m.start_time + timedelta(minutes=minutes)).fetch_live([PL], [m.ref])[0]
        seen.append((live.status, live.clock, live.home_score, live.away_score))
    assert [s[0] for s in seen] == ["live"] * 5 + ["finished"]
    assert seen[2][1] == "HT"
    assert seen[-1][2:] == final
    totals = [s[2] + s[3] for s in seen]
    assert totals == sorted(totals)  # goals never disappear


def test_basketball_has_no_ties_and_quarters_add_up():
    now = ANCHOR + timedelta(days=40)
    games = provider(now).fetch_fixtures(NBA, ANCHOR, ANCHOR + timedelta(days=20))
    assert games
    for g in games:
        assert g.home_score != g.away_score
        q = g.score_detail["quarters"]
        assert sum(x[0] for x in q) == g.home_score and sum(x[1] for x in q) == g.away_score


def test_override_moves_kickoff():
    later = provider(ANCHOR).fetch_fixtures(PL, ANCHOR + timedelta(days=12), ANCHOR + timedelta(days=13))[0]
    now = ANCHOR + timedelta(days=5, hours=12)
    moved = provider(now, overrides={later.ref: (now - timedelta(minutes=20)).isoformat()})
    live = moved.fetch_live([PL], [later.ref])[0]
    assert live.status == "live" and live.start_time == now - timedelta(minutes=20)
    window = moved.fetch_fixtures(PL, now - timedelta(hours=1), now)
    assert later.ref in {m.ref for m in window}


def test_squads_change_week_to_week():
    teams = ["arsenal", "chelsea", "liverpool", "man-city"]
    p1 = provider(ANCHOR + timedelta(days=3)).fetch_squads(PL, teams)
    assert len(p1) == 4 * 7 and any(p.tag == "top_scorer" for p in p1)
    statuses = [tuple(p.status for p in provider(ANCHOR + timedelta(weeks=w)).fetch_squads(PL, teams)) for w in range(8)]
    assert len(set(statuses)) > 1
