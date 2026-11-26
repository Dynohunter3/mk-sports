/**
 * Team strength history: the model's own Elo rating over the seasons (elo/<competition>.json from the data
 * pipeline), with the league's average for context.
 */
import { useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { EloTeam, matchTeam, useEloHistory } from '@/data/published';
import { alpha, readable, space, useTheme } from '@/theme/theme';

import { Glass } from './glass';
import { SectionHeader, Text } from './ui';

const H = 150;
const PAD_L = 34;
const DAY_MS = 86400000;
const monthDay = (m: string) => Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 15) / DAY_MS;
const fmtMonth = (day: number) => new Date(day * DAY_MS).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const ord = (n: number) => `${n}${['st', 'nd', 'rd'][((((n + 90) % 100) - 10) % 10) - 1] ?? 'th'}`;

export function peakAndLow(t: EloTeam): { peak: [number, number]; low: [number, number] } {
  let peak = t.points[0];
  let low = t.points[0];
  for (const p of t.points) {
    if (p[1] > peak[1]) peak = p;
    if (p[1] < low[1]) low = p;
  }
  return { peak, low };
}

export function EloHistoryCard({ league, names, color, leagueName }: { league: string; names: (string | null | undefined)[]; color?: string; leagueName?: string }) {
  const t = useTheme();
  const doc = useEloHistory(league);
  const [w, setW] = useState(0);
  const team = doc ? matchTeam(doc.teams, names) : null;
  if (!doc || !team || team.points.length < 3) return null;
  const line = readable(color ?? t.brand, t, t.brand);
  const pts = team.points;
  const avg = doc.league_average.map(([m, v]) => [monthDay(m), v] as [number, number]).filter(([d]) => d >= pts[0][0]);
  const x0 = pts[0][0];
  const x1 = pts[pts.length - 1][0];
  const all = [...pts.map((p) => p[1]), ...avg.map((p) => p[1])];
  const lo = Math.floor((Math.min(...all) - 20) / 50) * 50;
  const hi = Math.ceil((Math.max(...all) + 20) / 50) * 50;
  const cw = Math.max(1, w - PAD_L);
  const x = (d: number) => PAD_L + ((d - x0) / Math.max(1, x1 - x0)) * cw;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const path = (ps: [number, number][]) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  // season boundaries (1 July), labelled every other season on narrow screens
  const seasons: number[] = [];
  for (let yr = new Date(x0 * DAY_MS).getUTCFullYear(); yr <= new Date(x1 * DAY_MS).getUTCFullYear(); yr++) {
    const d = Date.UTC(yr, 6, 1) / DAY_MS;
    if (d > x0 && d < x1) seasons.push(d);
  }
  const every = cw / Math.max(1, seasons.length) < 34 ? 2 : 1;
  const ticks = [lo, (lo + hi) / 2, hi];
  const { peak, low } = peakAndLow(team);
  const last = pts[pts.length - 1];
  const n = doc.teams.length;
  return (
    <>
      <SectionHeader title="Team strength" icon="chart-line" />
      <Glass>
        <Text v="h3" accessibilityLabel={`Rating ${team.rating}, ${ord(team.rank)} of ${n} by rating`}>
          Rating {team.rating} · {ord(team.rank)} of {n} by rating
        </Text>
        <Text v="small" dim style={{ marginTop: 2 }}>
          Highest {peak[1]} ({fmtMonth(peak[0])}) · lowest {low[1]} ({fmtMonth(low[0])})
        </Text>
        <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ height: H + 22, marginTop: space.md }}>
          {w > 0 ? (
            <Svg width={w} height={H + 22}>
              {ticks.map((v) => (
                <Line key={v} x1={PAD_L} x2={w} y1={y(v)} y2={y(v)} stroke={alpha(t.text, 0.08)} strokeWidth={1} />
              ))}
              {ticks.map((v) => (
                <SvgText key={`l${v}`} x={PAD_L - 4} y={y(v) + 4} fontSize={10} fill={t.textMuted} textAnchor="end" fontFamily="sans-serif">
                  {Math.round(v)}
                </SvgText>
              ))}
              {seasons.map((d, i) => (
                <Line key={d} x1={x(d)} x2={x(d)} y1={0} y2={H} stroke={alpha(t.text, 0.06)} strokeWidth={1} />
              ))}
              {seasons.map((d, i) =>
                i % every === 0 ? (
                  <SvgText key={`s${d}`} x={x(d) + 2} y={H + 15} fontSize={10} fill={t.textMuted} fontFamily="sans-serif">
                    {`${String(new Date(d * DAY_MS).getUTCFullYear()).slice(2)}/${String(new Date(d * DAY_MS).getUTCFullYear() + 1).slice(2)}`}
                  </SvgText>
                ) : null,
              )}
              {avg.length > 1 ? <Path d={path(avg)} stroke={alpha(t.text, 0.4)} strokeWidth={1.5} strokeDasharray="4 4" fill="none" /> : null}
              <Path d={path(pts)} stroke={line} strokeWidth={2.2} fill="none" strokeLinejoin="round" />
              <Circle cx={x(last[0])} cy={y(last[1])} r={4} fill={line} />
            </Svg>
          ) : null}
        </View>
        <Text v="tiny" muted style={{ marginTop: space.xs }}>
          Solid: {names.find(Boolean) ?? team.name}. Dashed: the {leagueName ?? 'league'} average. {doc.about}
        </Text>
      </Glass>
    </>
  );
}
