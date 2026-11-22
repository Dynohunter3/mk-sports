import { router } from 'expo-router';
import { Fragment, memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { CallTier, Confidence, MatchCard as MatchCardT, PredictionMini, StandingRow, TeamMini } from '@/api/types';
import { dayLabel, kickoffTime, pct } from '@/lib/format';
import { alpha, leagueColors, radius, space, SPORT_COLORS, TAP, useTheme } from '@/theme/theme';

import { Crest } from './crest';
import { Icon, Row, Text } from './ui';

/** Team crest (official logo from the data source; colours + initials while it loads or if it can't). */
export const TeamBadge = memo(function TeamBadge({ team, size = 28, plate }: { team: TeamMini; size?: number; plate?: boolean }) {
  return <Crest team={{ code: team.code, color: team.color, logo: team.logo, name: team.name }} size={size} plate={plate} />;
});

/** "FT", "FT (OT)", "F/10" ... from the clock the API sends for finished games. */
export function finalLabel(clock: string | null): string {
  if (!clock || clock === 'FT') return 'FT';
  if (clock === 'FT/OT') return 'FT (OT)';
  if (clock === 'FT/SO') return 'FT (SO)';
  if (clock === 'AET' || clock === 'Pens' || clock.startsWith('F/')) return clock;
  return 'FT';
}

const TIER_TEXT: Record<CallTier, string> = { strong: 'Strong', likely: 'Likely', lean: 'Lean', 'toss-up': 'Toss-up' };
/** How strong the call is (from the pick's probability; each tier's backtest hit rate is on the Accuracy screen). */
export function TierPill({ tier }: { tier: CallTier }) {
  const t = useTheme();
  const color = tier === 'strong' ? t.win : tier === 'likely' ? t.brand : tier === 'lean' ? t.pending : t.textMuted;
  const bars = tier === 'strong' ? 3 : tier === 'likely' ? 2 : tier === 'lean' ? 1 : 0;
  return (
    <View style={[s.pill, { borderColor: color + '88', backgroundColor: color + '1A' }]} accessibilityLabel={`${TIER_TEXT[tier]} call`}>
      <View style={{ flexDirection: 'row', gap: 2, alignItems: 'flex-end' }}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={{ width: 3, height: 4 + i * 3, borderRadius: 1, backgroundColor: i <= bars ? color : color + '40' }} />
        ))}
      </View>
      <Text v="tiny" color={color} style={{ fontWeight: '700' }}>
        {TIER_TEXT[tier]}
      </Text>
    </View>
  );
}

/** The call on a card: "Draw" gets its own colour so draw calls stand out. */
export function CallBadge({ p, home, away }: { p: PredictionMini; home: string; away: string }) {
  const t = useTheme();
  const draw = p.pick === 'draw';
  const c = draw ? t.accent2 : t.brand;
  return (
    <Row gap={6} style={{ flexShrink: 1 }}>
      <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: 1, borderColor: alpha(c, 0.7), backgroundColor: draw ? alpha(c, 0.15) : undefined }}>
        <Text v="tiny" color={c} style={{ fontWeight: '900' }}>
          {draw ? 'DRAW' : 'AI'}
        </Text>
      </View>
      <Text v="small" style={{ fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
        {p.pick === 'home' ? home : p.pick === 'away' ? away : 'Draw'} · {pct(p.pick === 'home' ? p.home : p.pick === 'away' ? p.away : p.draw)}
        {p.draw_note && !draw ? ' · draw possible' : ''}
      </Text>
    </Row>
  );
}

export function ConfidencePill({ level }: { level: Confidence }) {
  const t = useTheme();
  const color = level === 'high' ? t.win : level === 'medium' ? t.pending : t.draw;
  const bars = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  return (
    <View style={[s.pill, { borderColor: color + '88', backgroundColor: color + '1A' }]} accessibilityLabel={`${level} confidence`}>
      <View style={{ flexDirection: 'row', gap: 2, alignItems: 'flex-end' }}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={{ width: 3, height: 4 + i * 3, borderRadius: 1, backgroundColor: i <= bars ? color : color + '40' }} />
        ))}
      </View>
      <Text v="tiny" color={color} style={{ fontWeight: '700', textTransform: 'capitalize' }}>
        {level}
      </Text>
    </View>
  );
}

/** Home / draw / away probability bar. */
export function ProbabilityBar({ p, home, away, height = 8, showLabels = true }: { p: Pick<PredictionMini, 'home' | 'draw' | 'away'>; home: string; away: string; height?: number; showLabels?: boolean }) {
  const t = useTheme();
  const segs: { key: string; v: number; color: string; label: string }[] = [
    { key: 'home', v: p.home, color: t.brand, label: home },
    ...(p.draw !== null && p.draw !== undefined ? [{ key: 'draw', v: p.draw, color: t.draw, label: 'Draw' }] : []),
    { key: 'away', v: p.away, color: t.pending, label: away },
  ];
  return (
    <View accessible accessibilityLabel={segs.map((x) => `${x.label} ${pct(x.v)}`).join(', ')}>
      <View style={{ flexDirection: 'row', height, borderRadius: height / 2, overflow: 'hidden', gap: 2 }}>
        {segs.map((x) => (
          <View key={x.key} style={{ flex: Math.max(x.v, 0.02), backgroundColor: x.color }} />
        ))}
      </View>
      {showLabels ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          {segs.map((x, i) => (
            <View key={x.key} style={{ flex: 1, alignItems: i === 0 ? 'flex-start' : i === segs.length - 1 ? 'flex-end' : 'center' }}>
              <Text v="mono" color={x.color} style={{ fontSize: 14 }}>
                {pct(x.v)}
              </Text>
              <Text v="tiny" dim numberOfLines={1}>
                {x.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function StatusChip({ m }: { m: Pick<MatchCardT, 'status' | 'clock' | 'start_time'> }) {
  const t = useTheme();
  if (m.status === 'live') {
    return (
      <Row gap={4}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.live }} />
        <Text v="small" color={t.live} style={{ fontWeight: '800' }}>
          {m.clock ?? 'LIVE'}
        </Text>
      </Row>
    );
  }
  if (m.status === 'finished') return <Text v="small" muted style={{ fontWeight: '700' }}>{finalLabel(m.clock)}</Text>;
  if (m.status === 'postponed') return <Text v="small" color={t.pending}>Postponed</Text>;
  if (m.status === 'cancelled') return <Text v="small" color={t.loss}>Cancelled</Text>;
  const d = new Date(m.start_time);
  const label = dayLabel(d);
  return (
    <Text v="small" dim style={{ fontWeight: '600' }}>
      {label === 'Today' ? kickoffTime(m.start_time) : `${label} · ${kickoffTime(m.start_time)}`}
    </Text>
  );
}

function PickTag({ m }: { m: MatchCardT }) {
  const t = useTheme();
  const p = m.my_pick;
  if (!p) return null;
  const color = p.status === 'won' ? t.win : p.status === 'lost' ? t.loss : p.status === 'void' ? t.draw : t.brand;
  const what = p.pick === 'home' ? m.home.code : p.pick === 'away' ? m.away.code : 'Draw';
  const score = p.home_score !== null && p.away_score !== null ? ` ${p.home_score}-${p.away_score}` : '';
  const pts = p.status === 'won' || p.status === 'lost' ? ` · ${p.points} pts` : '';
  return (
    <View style={[s.pickTag, { borderColor: color, backgroundColor: color + '1A' }]}>
      <Icon name={p.status === 'won' ? 'check' : p.status === 'lost' ? 'close' : 'hand-pointing-right'} size={12} color={color} />
      <Text v="tiny" color={color} style={{ fontWeight: '700' }}>
        {what}
        {score}
        {pts}
      </Text>
    </View>
  );
}

/** One row in any match list: home name + crest | score | crest + away name, scorers below. */
export const MatchRow = memo(function MatchRow({ m, showLeague = true }: { m: MatchCardT; showLeague?: boolean }) {
  const t = useTheme();
  const lc = leagueColors(m.league.id);
  const accent = lc?.accent ?? SPORT_COLORS[m.sport] ?? t.brand;
  const started = m.status === 'live' || m.status === 'finished';
  const live = m.status === 'live';
  const hs = m.home_score ?? 0;
  const as = m.away_score ?? 0;
  const homeLead = started && hs > as;
  const awayLead = started && as > hs;
  const p = m.prediction;
  const goals = m.goals ?? [];
  const scorers = (side: 'home' | 'away') =>
    goals
      .filter((g) => g.side === side && g.player)
      .slice(0, 4)
      .map((g, i) => (
        <Row key={`${side}-${i}`} gap={4} style={{ justifyContent: side === 'home' ? 'flex-end' : 'flex-start', flexDirection: side === 'home' ? 'row' : 'row-reverse' }}>
          <Text v="tiny" dim numberOfLines={1} style={{ flexShrink: 1, textAlign: side === 'home' ? 'right' : 'left' }}>
            {g.player!.split(' ').slice(-1)[0]} {g.clock ?? ''}
            {g.type === 'own_goal' ? ' (og)' : g.type === 'penalty_goal' ? ' (p)' : ''}
          </Text>
          <Icon name="soccer" size={11} color={t.textMuted} />
        </Row>
      ));
  const center = started ? (
    <Text style={{ fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] }} color={live ? t.brand : t.text} accessibilityLabel={`${hs} to ${as}`}>
      {hs} - {as}
    </Text>
  ) : (
    <Text v="h3" style={{ fontVariant: ['tabular-nums'] }}>
      {kickoffTime(m.start_time)}
    </Text>
  );
  return (
    <Pressable
      onPress={() => router.push(`/match/${m.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${m.home.name} versus ${m.away.name}`}
      style={({ pressed }) => [s.row, { backgroundColor: t.glass, borderColor: t.glassBorder, borderLeftColor: accent }, live && { borderColor: alpha(t.live, 0.5) }, pressed && { opacity: 0.75 }]}
    >
      <Row style={{ justifyContent: 'center', marginBottom: 8 }} gap={6}>
        {showLeague ? (
          <Text v="tiny" muted numberOfLines={1} style={{ fontWeight: '700', flexShrink: 1 }}>
            {m.league.short_name}
            {m.round ? ` · ${m.round}` : ''}
          </Text>
        ) : m.round ? (
          <Text v="tiny" muted numberOfLines={1}>
            {m.round}
          </Text>
        ) : null}
      </Row>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Row style={{ flex: 1, justifyContent: 'flex-end', minWidth: 0 }} gap={6}>
          <Text style={{ flexShrink: 1, textAlign: 'right', fontWeight: homeLead ? '900' : '700', fontSize: m.home.short_name.length > 11 ? 13 : 15 }} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
            {m.home.short_name}
          </Text>
          <TeamBadge team={m.home} size={34} />
        </Row>
        <View style={{ width: 80, alignItems: 'center' }}>{center}</View>
        <Row style={{ flex: 1, minWidth: 0 }} gap={6}>
          <TeamBadge team={m.away} size={34} />
          <Text style={{ flexShrink: 1, fontWeight: awayLead ? '900' : '700', fontSize: m.away.short_name.length > 11 ? 13 : 15 }} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
            {m.away.short_name}
          </Text>
        </Row>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        <View style={{ flex: 1, gap: 2, paddingRight: 6 }}>{scorers('home')}</View>
        <View style={{ width: 80, alignItems: 'center' }}>
          {m.status === 'scheduled' ? (
            <Text v="tiny" dim style={{ fontWeight: '700' }}>
              {dayLabel(new Date(m.start_time))}
            </Text>
          ) : (
            <StatusChip m={m} />
          )}
        </View>
        <View style={{ flex: 1, gap: 2, paddingLeft: 6 }}>{scorers('away')}</View>
      </View>
      {!started && p ? (
        <View style={{ marginTop: space.sm }}>
          <ProbabilityBar p={p} home={m.home.code} away={m.away.code} height={4} showLabels={false} />
          <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <CallBadge p={p} home={m.home.short_name} away={m.away.short_name} />
            {p.tier ? <TierPill tier={p.tier} /> : <ConfidencePill level={p.confidence} />}
          </Row>
        </View>
      ) : null}
      <PickTag m={m} />
    </Pressable>
  );
});

export function FormPills({ results }: { results: string }) {
  const t = useTheme();
  return (
    <Row gap={4}>
      {results.split('').map((r, i) => (
        <View key={i} style={[s.form, { backgroundColor: r === 'W' ? t.win : r === 'L' ? t.loss : t.draw }]}>
          <Text v="tiny" color="#fff" style={{ fontWeight: '800' }}>
            {r}
          </Text>
        </View>
      ))}
    </Row>
  );
}

type Col = { label: string; value: (r: StandingRow) => string | number; bold?: boolean; width?: number };
const signedDiff = (r: StandingRow) => {
  const d = r.points_for - r.points_against;
  return d > 0 ? `+${d}` : d;
};
const pctText = (r: StandingRow) => (r.win_pct === null || r.win_pct === undefined ? '' : r.win_pct.toFixed(3).replace(/^0/, ''));

export function columnsFor(sport: string | undefined, compact = false): Col[] {
  switch (sport) {
    case 'basketball':
    case 'baseball':
      return [
        { label: 'W', value: (r) => r.won },
        { label: 'L', value: (r) => r.lost },
        { label: 'PCT', value: pctText, bold: true, width: 40 },
        ...(compact ? [] : [{ label: 'GB', value: (r: StandingRow) => r.games_behind ?? '-', width: 34 }]),
      ];
    case 'american-football':
      return [
        { label: 'W', value: (r) => r.won },
        { label: 'L', value: (r) => r.lost },
        { label: 'T', value: (r) => r.drawn },
        { label: 'PCT', value: pctText, bold: true, width: 40 },
        ...(compact ? [] : [{ label: 'DIFF', value: signedDiff, width: 40 }]),
      ];
    case 'ice-hockey':
      return [
        { label: 'GP', value: (r) => r.played },
        { label: 'W', value: (r) => r.won },
        { label: 'L', value: (r) => r.lost },
        { label: 'OTL', value: (r) => r.ot_losses ?? 0, width: 32 },
        { label: 'PTS', value: (r) => r.points, bold: true, width: 32 },
      ];
    default:
      return [
        { label: 'P', value: (r) => r.played },
        { label: 'W', value: (r) => r.won },
        { label: 'D', value: (r) => r.drawn },
        { label: 'L', value: (r) => r.lost },
        { label: 'GD', value: signedDiff, width: 32 },
        { label: 'Pts', value: (r) => r.points, bold: true, width: 32 },
      ];
  }
}

export function StandingsTable({ rows, highlight = [], sport = 'football', compact = false, onTeam }: { rows: StandingRow[]; highlight?: string[]; sport?: string; compact?: boolean; hasDraws?: boolean; onTeam?: (team: TeamMini) => void }) {
  const t = useTheme();
  let shown = rows;
  if (compact && highlight.length) {
    const keep = new Set<number>(); // row indexes
    rows.forEach((r, i) => {
      if (highlight.includes(r.team.id)) [i - 2, i - 1, i, i + 1, i + 2].forEach((j) => j >= 0 && j < rows.length && keep.add(j));
    });
    shown = rows.filter((_, i) => keep.has(i));
  }
  const cols = columnsFor(sport, compact);
  return (
    <View>
      <Row style={s.tableHead} gap={2}>
        <Text v="tiny" muted style={{ width: 24 }}>#</Text>
        <Text v="tiny" muted style={{ flex: 1 }}>Team</Text>
        {cols.map((c) => (
          <Text key={c.label} v="tiny" muted style={[s.tableCell, c.width ? { width: c.width } : null]}>
            {c.label}
          </Text>
        ))}
      </Row>
      {shown.map((r, idx) => {
        const on = highlight.includes(r.team.id);
        const rowBody = (
          <Row style={[s.tableRow, { borderColor: t.glassBorder }, on && { backgroundColor: alpha(t.brand, 0.14) }]} gap={2}>
            <Text v="small" dim style={{ width: 24, fontWeight: '700' }}>
              {r.position}
            </Text>
            <Row style={{ flex: 1 }} gap={8}>
              <TeamBadge team={r.team} size={22} />
              <Text v="small" numberOfLines={1} style={{ flex: 1, fontWeight: on ? '800' : '600' }}>
                {r.team.short_name}
              </Text>
            </Row>
            {cols.map((c) => (
              <Text key={c.label} v="small" style={[s.tableCell, c.width ? { width: c.width } : null, c.bold ? { fontWeight: '800' } : null]}>
                {String(c.value(r))}
              </Text>
            ))}
          </Row>
        );
        return (
          <Fragment key={r.team.id}>
            {r.group && (idx === 0 || shown[idx - 1].group !== r.group) ? (
              <Text v="label" dim style={{ marginTop: idx ? space.md : 0, marginBottom: 4 }}>
                {r.group}
              </Text>
            ) : null}
            {onTeam ? (
              <Pressable onPress={() => onTeam(r.team)} accessibilityRole="button" accessibilityLabel={`${r.team.name}, position ${r.position}`}>
                {rowBody}
              </Pressable>
            ) : (
              rowBody
            )}
          </Fragment>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth * 2, borderLeftWidth: 3, padding: space.md, marginBottom: space.sm, minHeight: TAP + 24 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1 },
  pickTag: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.sm, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1 },
  form: { width: 20, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  tableHead: { paddingVertical: 6 },
  tableRow: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, minHeight: 40 },
  tableCell: { width: 26, textAlign: 'center' },
});
