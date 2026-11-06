import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clampScore, dayLabel, flag, initials, outcomeLabel, pct, relative, rulesText } from './format';

test('relative times', () => {
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);
  assert.equal(relative(now + (2 * 60 + 14) * 60_000, now), 'in 2h 14m');
  assert.equal(relative(now + 45_000, now), 'in 45s');
  assert.equal(relative(now - 3 * 86_400_000, now), '3d ago');
  assert.equal(relative(now + 60 * 60_000, now), 'in 1h');
});

test('day labels', () => {
  const now = new Date(2026, 10, 3, 12);
  assert.equal(dayLabel(new Date(2026, 10, 3, 20), now), 'Today');
  assert.equal(dayLabel(new Date(2026, 10, 4, 1), now), 'Tomorrow');
  assert.equal(dayLabel(new Date(2026, 10, 2, 1), now), 'Yesterday');
  assert.equal(dayLabel(new Date(2026, 10, 7, 15), now), 'Sat 7 Nov');
});

test('misc helpers', () => {
  assert.equal(pct(0.584), '58%');
  assert.equal(pct(null), '–');
  assert.equal(flag('zm'), '🇿🇲');
  assert.equal(flag(null), '');
  assert.equal(initials('Chanda Mwila'), 'CM');
  assert.equal(initials('You (Demo)'), 'YD');
  assert.equal(outcomeLabel('draw', 'A', 'B'), 'Draw');
  assert.equal(clampScore(-3, 15), 0);
  assert.equal(clampScore(99, 15), 15);
});

test('rules text', () => {
  assert.equal(rulesText({ result_points: 3, exact_score_bonus: 2, margin_bonus: 0, margin_tolerance: 0 }, true), '3 pts for the correct result, +2 for the exact score');
  assert.match(rulesText({ result_points: 3, exact_score_bonus: 5, margin_bonus: 1, margin_tolerance: 3 }, false), /winner.*within 3/);
});
