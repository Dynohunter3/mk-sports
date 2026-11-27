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

test('light mode: every text colour reads on the background and on white cards (WCAG AA, 4.5:1)', async () => {
  const { light, dark } = await import('../theme/palette');
  for (const k of ['text', 'textDim', 'textMuted', 'brand', 'accent2', 'win', 'loss', 'pending', 'gold', 'violet', 'hot'] as const) {
    assert.ok(contrastRatio(light[k], light.bg) >= 4.5, `${k} on background: ${contrastRatio(light[k], light.bg).toFixed(2)}`);
    assert.ok(contrastRatio(light[k], '#FFFFFF') >= 4.5, `${k} on white`);
  }
  // fills that carry white text (pills, result badges, buttons)
  for (const k of ['brand', 'live', 'win', 'loss', 'draw'] as const) assert.ok(contrastRatio('#FFFFFF', light[k]) >= 4.5, `white on ${k}`);
  // deep headers keep white text readable in light mode too
  assert.ok(contrastRatio('#FFFFFF', light.heroFrom) >= 4.5 && contrastRatio('#FFFFFF', light.heroTo) >= 4.5);
  // dark mode text, for completeness
  for (const k of ['text', 'textDim', 'brand'] as const) assert.ok(contrastRatio(dark[k], dark.bg) >= 4.5, `dark ${k}`);
});
