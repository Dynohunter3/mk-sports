/** The four share cards. Each is laid out at 360 x 640 and saved at 1080 x 1920 (see sharecard.tsx). */
import { View } from 'react-native';

import type { LeagueRow, MatchDetail, PrivateLeague, SeasonRecap, WeekReport } from '@/api/types';
import { kickoffTime, dayLabel, outcomeLabel } from '@/lib/format';
import { FONTS } from '@/theme/fonts';
import { alpha } from '@/theme/theme';

import { CardBadge, CardFrame, CardStat } from './sharecard';
import { Text } from './ui';

const W = '#FFFFFF';
const DIM = 'rgba(255,255,255,0.75)';
const GREEN = '#2CF59A';
const HOT = '#FF3D81';
const pct = (x: number) => `${Math.round(x * 100)}%`;

const weekDates = (key: string) => {
  // ISO week key (2026-W48) -> "23–29 Nov"
  const [y, w] = key.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = new Date(jan4.getTime() + ((w - 1) * 7 - ((jan4.getUTCDay() + 6) % 7)) * 86400000);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  const f = (d: Date, month: boolean) => d.toLocaleDateString(undefined, { day: 'numeric', ...(month ? { month: 'short' } : {}), timeZone: 'UTC' });
  return `${f(mon, mon.getUTCMonth() !== sun.getUTCMonth())}–${f(sun, true)}`;
};

export function WeekCard({ name, avatar, level, r }: { name: string; avatar: string; level: string; r: WeekReport }) {
  const lead = r.vs_ai.you > r.vs_ai.ai ? 'I beat the AI' : r.vs_ai.you < r.vs_ai.ai ? 'The AI won this one' : r.vs_ai.matches ? 'Level with the AI' : 'My week';
  return (
    <CardFrame kicker={`${r.current ? 'This week' : 'Last week'} · ${weekDates(r.week)}`}>
      <Text style={{ color: W, fontFamily: FONTS.displayItalic, fontSize: 40, lineHeight: 44, textTransform: 'uppercase', marginTop: 4 }}>{lead}</Text>
      <Text style={{ color: DIM, fontSize: 15, marginTop: 6 }}>
        {avatar} {name} · {level}
      </Text>
      {r.vs_ai.matches ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 28 }}>
          <CardStat value={String(r.vs_ai.you)} label="Me" color={r.vs_ai.you >= r.vs_ai.ai ? GREEN : W} />
          <Text style={{ color: DIM, fontFamily: FONTS.display, fontSize: 28 }}>v</Text>
          <CardStat value={String(r.vs_ai.ai)} label="The AI" color={r.vs_ai.ai > r.vs_ai.you ? HOT : W} />
        </View>
      ) : null}
      {r.vs_ai.matches ? <Text style={{ color: DIM, fontSize: 13, textAlign: 'center', marginTop: 4 }}>right out of {r.vs_ai.matches} matches we both called</Text> : null}
      <View style={{ flexDirection: 'row', marginTop: 30 }}>
        <CardStat value={String(r.points)} label="Points" />
        <CardStat value={`${r.correct}/${r.picks}`} label="Right" />
        <CardStat value={String(r.exact)} label="Exact scores" />
      </View>
      {r.banker ? (
        <Text style={{ color: r.banker.won ? GREEN : DIM, fontSize: 14, textAlign: 'center', marginTop: 22 }}>
          ⭐ Banker: {r.banker.match} {r.banker.won ? `(+${r.banker.points} double points)` : '(missed)'}
        </Text>
      ) : null}
    </CardFrame>
  );
}

export function MatchShareCard({ m }: { m: MatchDetail }) {
  const p = m.prediction;
  const pf = m.prediction_full;
  if (!p) return null;
  const parts = [
    { k: 'home' as const, v: p.home, c: m.home.color },
    ...(p.draw !== null ? [{ k: 'draw' as const, v: p.draw, c: '#94A3B8' }] : []),
    { k: 'away' as const, v: p.away, c: m.away.color },
  ];
  return (
    <CardFrame kicker={`AI prediction · ${m.league.short_name}`} accent={GREEN}>
      <Text style={{ color: DIM, fontSize: 14, marginTop: 4 }}>
        {dayLabel(new Date(m.start_time))} {kickoffTime(m.start_time)}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
        {[m.home, m.away].map((tm, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', gap: 10 }}>
            <CardBadge color={tm.color} code={tm.code} logo={tm.logo} />
            <Text style={{ color: W, fontFamily: FONTS.display, fontSize: 22, textAlign: 'center', textTransform: 'uppercase' }} numberOfLines={2}>
              {tm.short_name}
            </Text>
          </View>
        ))}
      </View>
      <Text style={{ color: GREEN, fontFamily: FONTS.displayItalic, fontSize: 34, textAlign: 'center', textTransform: 'uppercase', marginTop: 26 }} numberOfLines={2} adjustsFontSizeToFit>
        {outcomeLabel(p.pick, m.home.short_name, m.away.short_name)}
      </Text>
      <Text style={{ color: DIM, fontSize: 13, textAlign: 'center' }}>
        {pf?.call ? `${pf.call.tier_label} · ` : ''}most likely score {p.score[0]}-{p.score[1]}
      </Text>
      <View style={{ flexDirection: 'row', height: 16, borderRadius: 8, overflow: 'hidden', marginTop: 22 }}>
        {parts.map((x) => (
          <View key={x.k} style={{ flex: Math.max(x.v, 0.01), backgroundColor: x.c }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
        {parts.map((x) => (
          <Text key={x.k} style={{ color: W, fontSize: 14, fontWeight: '800' }}>
            {x.k === 'home' ? m.home.code : x.k === 'away' ? m.away.code : 'Draw'} {pct(x.v)}
          </Text>
        ))}
      </View>
      {m.my_pick ? (
        <Text style={{ color: W, fontSize: 15, textAlign: 'center', marginTop: 22 }}>
          My pick: <Text style={{ color: GREEN, fontWeight: '800', fontSize: 15 }}>{outcomeLabel(m.my_pick.pick, m.home.short_name, m.away.short_name)}</Text>
        </Text>
      ) : (
        <Text style={{ color: DIM, fontSize: 14, textAlign: 'center', marginTop: 22 }}>Think you know better? Pick against the AI.</Text>
      )}
    </CardFrame>
  );
}

export function LeagueShareCard({ l, meId }: { l: PrivateLeague; meId: string }) {
  const rows: LeagueRow[] = l.members.slice(0, 8);
  const award = l.awards?.last_week.items.find((a) => a.key === 'sharpshooter');
  return (
    <CardFrame kicker={`Private league · code ${l.code}`} accent="#FFC93C">
      <Text style={{ color: W, fontFamily: FONTS.displayItalic, fontSize: 36, lineHeight: 40, textTransform: 'uppercase' }} numberOfLines={2}>
        {l.name}
      </Text>
      <View style={{ marginTop: 18, gap: 6 }}>
        {rows.map((r) => (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: r.id === meId ? alpha(GREEN, 0.16) : 'rgba(255,255,255,0.05)' }}>
            <Text style={{ color: r.rank <= 3 ? '#FFC93C' : DIM, fontFamily: FONTS.display, fontSize: 20, width: 26 }}>{r.rank}</Text>
            <Text style={{ fontSize: 18 }}>{r.avatar}</Text>
            <Text style={{ color: W, fontSize: 15, fontWeight: r.id === meId ? '900' : '600', flex: 1 }} numberOfLines={1}>
              {r.name}
            </Text>
            <Text style={{ color: W, fontFamily: FONTS.display, fontSize: 20 }}>{r.points}</Text>
          </View>
        ))}
      </View>
      {l.members.length > rows.length ? <Text style={{ color: DIM, fontSize: 12, marginTop: 6 }}>+{l.members.length - rows.length} more</Text> : null}
      {award ? (
        <Text style={{ color: '#FFC93C', fontSize: 14, marginTop: 14 }}>
          {award.emoji} {award.title}: {award.winners.map((w) => w.name).join(', ')} ({award.detail})
        </Text>
      ) : null}
      <Text style={{ color: DIM, fontSize: 13, marginTop: 10 }}>Join with code {l.code} in MK Sports.</Text>
    </CardFrame>
  );
}

export function RecapCard({ name, avatar, r }: { name: string; avatar: string; r: SeasonRecap }) {
  const b = r.best_pick;
  return (
    <CardFrame kicker={`Season ${r.season} recap`} accent="#9B6BFF">
      <Text style={{ color: DIM, fontSize: 15 }}>
        {avatar} {name}
      </Text>
      <View style={{ flexDirection: 'row', marginTop: 18 }}>
        <CardStat value={String(r.points)} label="Points" />
        <CardStat value={r.accuracy === null ? '–' : pct(r.accuracy)} label="Right" />
        <CardStat value={String(r.longest_streak)} label="Best streak" />
      </View>
      {r.vs_ai.matches ? (
        <Text style={{ color: W, fontSize: 16, textAlign: 'center', marginTop: 18 }}>
          Me <Text style={{ color: GREEN, fontWeight: '900', fontSize: 16 }}>{r.vs_ai.you}</Text> v{' '}
          <Text style={{ color: HOT, fontWeight: '900', fontSize: 16 }}>{r.vs_ai.ai}</Text> the AI
        </Text>
      ) : null}
      {b ? (
        <View style={{ marginTop: 20, padding: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' }}>
          <Text style={{ color: '#9B6BFF', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8 }}>Best pick</Text>
          <Text style={{ color: W, fontSize: 16, fontWeight: '800', marginTop: 2 }}>
            {outcomeLabel(b.pick, b.home, b.away)}
            {b.final_score ? ` (${b.final_score[0]}-${b.final_score[1]})` : ''}
          </Text>
          <Text style={{ color: DIM, fontSize: 13 }}>{b.ai_chance !== null ? `The AI gave it ${pct(b.ai_chance)}` : b.against_ai ? 'Against the AI' : `${b.points} points`}</Text>
        </View>
      ) : null}
      {r.best_team ? (
        <Text style={{ color: W, fontSize: 15, marginTop: 14 }}>
          Called best: <Text style={{ color: GREEN, fontWeight: '800', fontSize: 15 }}>{r.best_team.name}</Text> ({r.best_team.correct} of {r.best_team.picks})
        </Text>
      ) : null}
    </CardFrame>
  );
}
