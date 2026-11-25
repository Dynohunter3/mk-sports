/**
 * Live win probability card for the match centre: home / draw / away through the match, from the model's
 * pre-match expected goals, the minutes left, red cards and the score (engine/winprob.ts). It is worked out
 * on the phone from the match page's own data and redrawn on each refresh.
 */
import { useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { MatchDetail } from '@/api/types';
import { clockMinute, eventsFromDetail, MATCH_MINUTES, winProbabilityPath, type WPPoint } from '@/engine/winprob';
import { alpha, matchColors, space, useTheme } from '@/theme/theme';

import { Glass } from './glass';
import { PulseDot } from './motion';
import { Row, SectionHeader, Text } from './ui';

const H = 140;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function winProbabilityFor(m: MatchDetail, expected: [number, number]): { path: WPPoint[]; minute: number } | null {
  if (m.sport !== 'football' || (m.status !== 'live' && m.status !== 'finished')) return null;
  const [lh, la] = expected;
  if (!(lh > 0 && la > 0)) return null;
  const done = m.status === 'finished';
  const minute = done ? 90 : Math.min(MATCH_MINUTES, clockMinute(m.clock, m.status) ?? 0);
  const ev = eventsFromDetail(m.events ?? [], [m.home_score, m.away_score]);
  const final: [number, number] | undefined = done && m.home_score !== null && m.away_score !== null ? [m.home_score, m.away_score] : undefined;
  return { path: winProbabilityPath(lh, la, ev, minute, done, final), minute };
}

export function WinProbabilityCard({ m, expected }: { m: MatchDetail; expected: [number, number] }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const wp = winProbabilityFor(m, expected);
  if (!wp) return null;
  const { path } = wp;
  const [hc, ac] = matchColors(m.home.color, m.away.color, t);
  const drawC = alpha(t.text, 0.22);
  const now = path[path.length - 1];
  const live = m.status === 'live';
  const span = MATCH_MINUTES;
  const x = (min: number) => (Math.min(min, span) / span) * w;
  const yH = (p: WPPoint) => p.home * H;
  const yD = (p: WPPoint) => (p.home + p.draw) * H;
  const fwd = (f: (p: WPPoint) => number) => path.map((p) => `L${x(p.minute).toFixed(1)},${f(p).toFixed(1)}`).join(' ');
  const back = (f: (p: WPPoint) => number) => [...path].reverse().map((p) => `L${x(p.minute).toFixed(1)},${f(p).toFixed(1)}`).join(' ');
  const x0 = x(path[0].minute);
  const xn = x(now.minute);
  const homeArea = `M${x0},0 L${xn},0 ${back(yH)} Z`;
  const drawArea = `M${x0},${yH(path[0])} ${fwd(yH)} ${back(yD)} Z`;
  const awayArea = `M${x0},${yD(path[0])} ${fwd(yD)} L${xn},${H} L${x0},${H} Z`;
  const ev = eventsFromDetail(m.events ?? [], [m.home_score, m.away_score]);
  const swing = path.reduce((acc, p, i) => (i && Math.abs(p.home - path[i - 1].home) > Math.abs(acc.d) ? { d: p.home - path[i - 1].home, min: p.minute } : acc), { d: 0, min: 0 });
  const label = `Win probability${live ? ' now' : ', final'}: ${m.home.short_name} ${pct(now.home)}, draw ${pct(now.draw)}, ${m.away.short_name} ${pct(now.away)}`;
  return (
    <>
      <SectionHeader title="Win probability" icon="chart-areaspline" color={t.accent2} />
      <Glass>
        <View accessible accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'space-between' }}>
          {(
            [
              [m.home.short_name, now.home, hc],
              ['Draw', now.draw, t.textDim],
              [m.away.short_name, now.away, ac],
            ] as const
          ).map(([name, v, c]) => (
            <View key={name} style={{ flex: 1, alignItems: name === 'Draw' ? 'center' : name === m.home.short_name ? 'flex-start' : 'flex-end' }}>
              <Text v="h2" style={{ fontSize: 26, lineHeight: 28 }} color={c}>
                {pct(v)}
              </Text>
              <Text v="tiny" muted numberOfLines={1}>
                {name}
              </Text>
            </View>
          ))}
        </View>
        {live ? (
          <Row gap={6} style={{ marginTop: 6 }}>
            <PulseDot color={t.live} />
            <Text v="tiny" muted>
              Live, updating with the match
            </Text>
          </Row>
        ) : null}
        <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ marginTop: space.md, height: H + 18 }} importantForAccessibility="no-hide-descendants">
          {w > 0 ? (
            <Svg width={w} height={H + 18}>
              <Rect x={0} y={0} width={w} height={H} rx={8} fill={alpha(t.text, 0.04)} />
              <Path d={homeArea} fill={alpha(hc, 0.85)} />
              <Path d={drawArea} fill={drawC} />
              <Path d={awayArea} fill={alpha(ac, 0.85)} />
              <Line x1={0} x2={w} y1={H / 2} y2={H / 2} stroke={alpha(t.text, 0.25)} strokeDasharray="3,4" strokeWidth={1} />
              <Line x1={x(45)} x2={x(45)} y1={0} y2={H} stroke={alpha(t.text, 0.18)} strokeWidth={1} />
              {live ? <Line x1={xn} x2={xn} y1={0} y2={H} stroke={t.text} strokeWidth={1.5} /> : null}
              {ev.map((e, i) => (
                <SvgText key={i} x={Math.max(6, Math.min(w - 6, x(e.minute)))} y={e.side === 'home' ? 13 : H - 5} fontSize={11} textAnchor="middle" fill="#fff">
                  {e.kind === 'goal' ? '⚽' : '🟥'}
                </SvgText>
              ))}
              {[
                [0, "0'"],
                [45, 'HT'],
                [90, "90'"],
              ].map(([min, l]) => (
                <SvgText key={String(l)} x={Math.max(10, Math.min(w - 12, x(min as number)))} y={H + 14} fontSize={10} fontFamily="sans-serif" fontWeight="bold" textAnchor="middle" fill={t.textMuted}>
                  {l as string}
                </SvgText>
              ))}
            </Svg>
          ) : null}
        </View>
        <Row gap={space.md} style={{ marginTop: 4, flexWrap: 'wrap' }}>
          {(
            [
              [m.home.short_name, hc],
              ['Draw', drawC],
              [m.away.short_name, ac],
            ] as const
          ).map(([name, c]) => (
            <Row key={name} gap={5}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c }} />
              <Text v="tiny" muted>
                {name}
              </Text>
            </Row>
          ))}
        </Row>
        {Math.abs(swing.d) >= 0.15 ? (
          <Text v="small" dim style={{ marginTop: space.sm }}>
            Biggest swing: {swing.min}', {m.home.short_name} {swing.d > 0 ? 'up' : 'down'} {Math.round(Math.abs(swing.d) * 100)} points.
          </Text>
        ) : null}
        <Text v="tiny" muted style={{ marginTop: space.sm }}>
          How it's worked out: the model's pre-match expected goals ({m.home.short_name} {expected[0].toFixed(1)}, {m.away.short_name} {expected[1].toFixed(1)}), scaled to the minutes left, adjusted for red cards and started from the score. Worked out on your phone; an estimate, not betting advice.
        </Text>
      </Glass>
    </>
  );
}
