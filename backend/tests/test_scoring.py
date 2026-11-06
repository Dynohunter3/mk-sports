"""Unit tests for the points system (pure functions)."""

from datetime import datetime, timedelta, timezone

import pytest

from app.services.periods import period_keys, season_key, week_key
from app.services.scoring import PickError, ScoringRules, best_streak, is_locked, outcome_of, score_pick, streak_from, validate_pick

FOOTBALL = ScoringRules(result_points=3, exact_score_bonus=2)
BASKETBALL = ScoringRules(result_points=3, exact_score_bonus=5, margin_bonus=1, margin_tolerance=3)


class TestScorePick:
    def test_correct_result_only(self):
        s = score_pick(FOOTBALL, "home", 2, 1)
        assert (s.points, s.status, s.result_correct, s.exact_score) == (3, "won", True, False)

    def test_correct_result_wrong_score(self):
        s = score_pick(FOOTBALL, "home", 3, 0, 2, 1)
        assert s.points == 3 and not s.exact_score

    def test_exact_score_bonus(self):
        s = score_pick(FOOTBALL, "home", 2, 1, 2, 1)
        assert (s.points, s.exact_score) == (5, True)

    def test_exact_draw(self):
        assert score_pick(FOOTBALL, "draw", 1, 1, 1, 1).points == 5
        assert score_pick(FOOTBALL, "draw", 0, 0, 1, 1).points == 3

    def test_wrong_result_scores_nothing(self):
        s = score_pick(FOOTBALL, "away", 2, 1, 1, 2)
        assert (s.points, s.status, s.result_correct) == (0, "lost", False)

    def test_wrong_result_never_gets_score_bonus(self):
        # predicted 1-1 draw, actual 2-1: even "close" scores give nothing without the result
        assert score_pick(BASKETBALL, "home", 100, 102, 101, 100).points == 0

    def test_margin_bonus_within_tolerance(self):
        s = score_pick(BASKETBALL, "home", 110, 104, 108, 100)  # predicted +8, actual +6
        assert (s.points, s.margin_bonus) == (4, True)

    def test_margin_bonus_outside_tolerance(self):
        s = score_pick(BASKETBALL, "home", 110, 104, 120, 100)  # +20 vs +6
        assert (s.points, s.margin_bonus) == (3, False)

    def test_exact_beats_margin(self):
        s = score_pick(BASKETBALL, "away", 99, 101, 99, 101)
        assert (s.points, s.exact_score, s.margin_bonus) == (8, True, False)

    def test_rules_from_catalog_dict(self):
        rules = ScoringRules.from_dict({"result_points": "3", "exact_score_bonus": 2, "unknown": 9})
        assert rules == FOOTBALL
        assert rules.max_points == 5
        assert BASKETBALL.max_points == 8
        assert ScoringRules.from_dict(None) == ScoringRules()


class TestValidatePick:
    def test_score_implies_outcome(self):
        assert validate_pick(True, None, 2, 0) == "home"
        assert validate_pick(True, None, 1, 1) == "draw"

    def test_outcome_without_score(self):
        assert validate_pick(False, "away", None, None) == "away"

    @pytest.mark.parametrize(
        "has_draws,pick,h,a,code",
        [
            (True, "home", 0, 2, "score_mismatch"),
            (True, "home", 1, None, "incomplete_score"),
            (False, "draw", None, None, "no_draws"),
            (False, None, 10, 10, "no_draws"),
            (True, "win", None, None, "invalid_pick"),
            (True, None, None, None, "invalid_pick"),
            (True, None, -1, 0, "invalid_score"),
            (True, None, 99, 0, "invalid_score"),
        ],
    )
    def test_rejections(self, has_draws, pick, h, a, code):
        with pytest.raises(PickError) as exc:
            validate_pick(has_draws, pick, h, a, max_score=15)
        assert exc.value.code == code


class TestLocking:
    KO = datetime(2026, 11, 7, 15, 0, tzinfo=timezone.utc)

    def test_open_before_kickoff(self):
        assert not is_locked("scheduled", self.KO, self.KO - timedelta(seconds=1))

    def test_locks_exactly_at_kickoff(self):
        assert is_locked("scheduled", self.KO, self.KO)

    def test_locks_when_not_scheduled_even_if_early(self):
        for status in ("live", "finished", "postponed", "cancelled"):
            assert is_locked(status, self.KO, self.KO - timedelta(hours=2))


class TestStreaks:
    def test_current_streak(self):
        assert streak_from([True, True, False, True]) == 2
        assert streak_from([False, True]) == 0
        assert streak_from([]) == 0

    def test_best_streak(self):
        assert best_streak([True, False, True, True, True, False, True]) == 3
        assert best_streak([]) == 0


class TestPeriods:
    def test_week_key_iso(self):
        assert week_key(datetime(2026, 11, 3, 12, tzinfo=timezone.utc)) == "2026-W45"
        # ISO year boundaries: Jan 1 2027 is a Friday in ISO week 53 of 2026
        assert week_key(datetime(2027, 1, 1, tzinfo=timezone.utc)) == "2026-W53"
        assert week_key(datetime(2027, 1, 4, tzinfo=timezone.utc)) == "2027-W01"

    def test_week_key_uses_utc(self):
        lusaka = timezone(timedelta(hours=2))
        # Monday 01:00 in Lusaka is still Sunday in UTC -> previous ISO week
        assert week_key(datetime(2026, 11, 9, 1, 0, tzinfo=lusaka)) == "2026-W45"

    def test_season_key(self):
        assert season_key(datetime(2026, 8, 15, tzinfo=timezone.utc)) == "2026-27"
        assert season_key(datetime(2027, 5, 20, tzinfo=timezone.utc)) == "2026-27"
        assert season_key(datetime(2027, 7, 1, tzinfo=timezone.utc)) == "2027-28"
        assert season_key(datetime(2026, 3, 1, tzinfo=timezone.utc), start_month=1) == "2026-27"

    def test_period_keys(self):
        assert period_keys(datetime(2026, 11, 3, tzinfo=timezone.utc)) == {"week": "2026-W45", "season": "2026-27", "all": "all"}


def test_outcome_of():
    assert outcome_of(1, 0) == "home" and outcome_of(0, 0) == "draw" and outcome_of(0, 3) == "away"
