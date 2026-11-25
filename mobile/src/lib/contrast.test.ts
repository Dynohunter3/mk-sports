import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contrastRatio, forWhiteText, onColor } from '../theme/color';

test('text on team colours: black on yellow and light kits, white on dark ones, by WCAG contrast', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#FFFFFF') - 21) < 1e-9);
  assert.equal(onColor('#FDE100'), '#0B0F14'); // yellow
  assert.equal(onColor('#F97316'), '#0B0F14'); // orange: white would be under 3:1
  assert.equal(onColor('#FFFFFF'), '#0B0F14');
  assert.equal(onColor('#0B1430'), '#FFFFFF'); // navy
  assert.equal(onColor('#C8102E'), '#FFFFFF'); // red
  for (const c of ['#FDE100', '#F97316', '#6CABDD', '#FFFFFF', '#2CF59A']) assert.ok(contrastRatio(onColor(c), c) >= 4.5, c);
});

test('team colours behind white headlines are darkened only as much as needed', () => {
  for (const c of ['#FDE100', '#FFFFFF', '#6CABDD', '#C8102E']) assert.ok(contrastRatio(forWhiteText(c), '#FFFFFF') >= 4.5, c);
  assert.equal(forWhiteText('#0B1430'), '#0B1430'); // already dark: unchanged
});
