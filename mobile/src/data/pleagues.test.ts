/** Private leagues: links round-trip, merging keeps the newest card, tables rank fairly. */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { memoryKV, setKV } from './kv';
import { type Card, create, decodeLeague, encodeLeague, fromB64url, join, leagues, linkFor, mergeCards, newCode, resetForTests, table, toB64url, validCode } from './pleagues';

const card = (id: string, p: Partial<Card> = {}): Card => ({ id, name: id, avatar: '⚽', points: 0, week: 0, wk: '2026-W48', correct: 0, settled: 0, streak: 0, at: 1000, ...p });

beforeEach(() => {
  setKV(memoryKV());
  resetForTests();
});

test('codes are 6 unambiguous characters', () => {
  for (let i = 0; i < 50; i++) {
    const c = newCode();
    assert.ok(validCode(c), c);
    assert.ok(!/[01OI]/.test(c), c);
  }
});

test('base64url round-trips any text, emoji included', () => {
  for (const s of ['', 'a', 'ab', 'abc', 'Office League ⚽🔥', 'Zé Müller — Lusaka 🇿🇲']) assert.equal(fromB64url(toB64url(s)), s);
  assert.ok(!/[+/=]/.test(toB64url('???>>>~~~')));
});

test('a league link carries the league and every card, and survives the trip', () => {
  const cards = [card('aaaaaaaa', { name: 'Chanda 🦁', points: 42, week: 9, correct: 14, settled: 20, streak: 3, at: 2000 }), card('bbbbbbbb', { name: 'Mwila', points: 30 })];
  const d = encodeLeague({ code: 'K7Q4FX', name: 'Office League' }, cards);
  const url = linkFor(d);
  assert.ok(url.startsWith('https://dynohunter3.github.io/mk-sports/l.html#d='));
  assert.ok(url.length < 2000, `link too long: ${url.length}`);
  const back = decodeLeague(d);
  assert.equal(back.code, 'K7Q4FX');
  assert.equal(back.name, 'Office League');
  assert.deepEqual(back.cards, cards);
  assert.throws(() => decodeLeague(toB64url('{"v":2}')));
  assert.throws(() => decodeLeague('not a link!'));
});

test('merging keeps the newest card for each member', () => {
  const m = mergeCards({ a: card('a', { points: 10, at: 100 }) }, [card('a', { points: 5, at: 50 }), card('b', { points: 7, at: 60 })]);
  assert.equal(m.a.points, 10); // the older card did not overwrite the newer one
  assert.equal(m.b.points, 7);
  assert.equal(mergeCards(m, [card('a', { points: 12, at: 200 })]).a.points, 12);
});

test('tables rank by points, then correct picks; ties share a rank; weekly tables use this week only', () => {
  const rows = table([card('a', { points: 20, correct: 7 }), card('b', { points: 20, correct: 9 }), card('c', { points: 31, week: 3, wk: '2026-W47' })], '2026-W48');
  assert.deepEqual(rows.map((r) => [r.id, r.rank]), [['c', 1], ['b', 2], ['a', 3]]);
  const tie = table([card('a', { points: 5, correct: 2 }), card('b', { points: 5, correct: 2 })], '2026-W48');
  assert.deepEqual(tie.map((r) => r.rank), [1, 1]);
  const week = table([card('a', { week: 6, wk: '2026-W48' }), card('c', { week: 9, wk: '2026-W47' })], '2026-W48', 'week');
  assert.deepEqual(week.map((r) => [r.id, r.score]), [['a', 6], ['c', 0]]); // last week's points don't count
});

test('create, then join from a link: the joiner gets everyone, keeps their own card', async () => {
  const me = card('meeeeeee', { name: 'Me', points: 3 });
  const l = await create('Sunday Five-a-side', me);
  assert.ok(validCode(l.code));
  const friend = card('ffffffff', { name: 'Friend', points: 9, at: 5000 });
  const joined = await join(l.code, 'Sunday Five-a-side', me, [friend, card('meeeeeee', { name: 'Old me', points: 0, at: 1 })]);
  assert.equal(Object.keys(joined.members).length, 2);
  assert.equal(joined.members.meeeeeee.name, 'Me'); // my live card wins over the copy in the link
  assert.equal((await leagues()).length, 1);
  await assert.rejects(join('bad', null, me));
});
