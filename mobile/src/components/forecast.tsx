/**
 * Season simulator views: the league forecast table (Stats > Forecast) and a team's forecast card (My Team and
 * team pages). The numbers come from simulations.json, which the data pipeline publishes every 6 hours.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { StandingRow } from '@/api/types';
import { headlineZone, matchTeam, SimLeague, simLeague, simPct, SimTeam, SimZoneKey, useSimulations, weeklyChange } from '@/data/published';
import { alpha, radius, space, useTheme } from '@/theme/theme';

import { Glass } from './glass';
import { TeamBadge } from './match';
import { Card, EmptyState, Loading, Row, SectionHeader, Text } from './ui';

const SHORT: Record<SimZoneKey, string> = { title: 'Title', top4: 'Top 4', europe: 'Top 6', promotion: 'Up', playoffs: 'P-offs', relegation: 'Down' };
const LONG: Record<SimZoneKey, string> = {
  title: 'title chance',
  top4: 'top-four chance',
  europe: 'top-six chance',
  promotion: 'automatic promotion chance',
  playoffs: 'play-off chance',
  relegation: 'relegation risk',
};
const ago = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function ChangeTag({ d, bad }: { d: number | null; bad?: boolean }) {
  const t = useTheme();
  if (d == null) return null;
  const up = d > 0;
  const good = bad ? !up : up;
  return (
    <Text v="tiny" color={good ? t.win : t.loss} style={{ fontWeight: '800' }}>
      {up ? '▲' : '▼'}
      {Math.abs(d)}
    </Text>
  );
}

/** Each finishing place as a small bar, so a team's whole range is visible at a glance. */
export function PositionBars({ league, team, color }: { league: SimLeague; team: SimTeam; color?: string }) {
  const t = useTheme();
  const max = Math.max(...team.positions, 0.0001);
  const zoneOf = (place: number) => league.zones.find((z) => z.key !== 'title' && place >= z.from && place <= z.to);
  return (
    <View accessibilityLabel={`Most likely finish: ${team.positions.indexOf(max) + 1}${ord(team.positions.indexOf(max) + 1)}`}>
      <Row gap={2} style={{ alignItems: 'flex-end', height: 54 }}>
        {team.positions.map((p, i) => {
          const z = zoneOf(i + 1);
          const c = z?.key === 'relegation' ? t.loss : z ? t.win : color ?? t.brand;
          return <View key={i} style={{ flex: 1, height: Math.max(2, (p / max) * 50), borderRadius: 2, backgroundColor: p > 0 ? c : alpha(t.text, 0.08), opacity: p > 0 ? 0.35 + 0.65 * (p / max) : 1 }} />;
        })}
      </Row>
      <Row style={{ justifyContent: 'space-between', marginTop: 2 }}>
        <Text v="tiny" muted>
          1st
        </Text>
        <Text v="tiny" muted>
          finishing place
        </Text>
        <Text v="tiny" muted>
          {team.positions.length}th
        </Text>
      </Row>
    </View>
  );
}

function ord(n: number) {
  return ['st', 'nd', 'rd'][((((n + 90) % 100) - 10) % 10) - 1] ?? 'th';
}

/** Stats > Forecast: the table with every team's chances. ESPN's table rows supply crests and colours. */
export function ForecastTable({ league, rows, onTeam }: { league: string; rows?: StandingRow[]; onTeam?: (id: string) => void }) {
  const t = useTheme();
  const doc = useSimulations();
  const [open, setOpen] = useState<string | null>(null);
  if (!doc) return <Loading label="Loading the season forecast…" />;
  const lg = simLeague(doc, league);
  if (!lg) {
    const why = doc.not_simulated[league];
    return <EmptyState icon="chart-bell-curve" title="No season forecast" body={why ? `This competition isn't simulated: ${why}.` : 'The season simulator covers league competitions the MK Sports model predicts.'} />;
  }
  const cols = lg.zones.filter((z) => z.key !== 'europe' && z.key !== 'playoffs').slice(0, 3);
  const espn = (st: SimTeam) => (rows ? matchTeam(rows.map((r) => ({ ...r, aliases: [r.team.name, r.team.short_name] })), [st.name, ...st.aliases]) : null);
  return (
    <View>
      <Card>
        <Text v="h3">Season forecast</Text>
        <Text v="small" dim style={{ marginTop: 4 }}>
          The {lg.remaining} fixtures left, played out {doc.simulations.toLocaleString()} times with the model&apos;s probabilities. Updated {ago(doc.generated_at)}
          {lg.week_ago ? `; arrows show the change since ${ago(lg.week_ago.at)} (2 points or more).` : '.'}
        </Text>
      </Card>
      <Glass style={{ marginTop: space.sm }}>
        <Row style={st.head} gap={2}>
          <Text v="tiny" muted style={{ width: 22 }}>
            #
          </Text>
          <Text v="tiny" muted style={{ flex: 1 }}>
            Team
          </Text>
          <Text v="tiny" muted style={st.num}>
            Pts
          </Text>
          <Text v="tiny" muted style={st.num}>
            Proj
          </Text>
          {cols.map((z) => (
            <Text key={z.key} v="tiny" muted style={st.pct}>
              {SHORT[z.key]}
            </Text>
          ))}
        </Row>
        {lg.teams.map((tm, i) => {
          const e = espn(tm);
          const isOpen = open === tm.id;
          return (
            <View key={tm.id} style={[st.row, { borderColor: t.glassBorder }]}>
              <Pressable
                onPress={() => setOpen(isOpen ? null : tm.id)}
                accessibilityRole="button"
                accessibilityLabel={`${tm.name}: ${cols.map((z) => `${LONG[z.key]} ${simPct(tm.zones[z.key])}`).join(', ')}. Projected ${Math.round(tm.exp_points)} points.`}
              >
                <Row gap={2} style={{ minHeight: 36 }}>
                  <Text v="small" dim style={{ width: 22, fontWeight: '700' }}>
                    {i + 1}
                  </Text>
                  <Row style={{ flex: 1 }} gap={6}>
                    {e ? <TeamBadge team={e.team} size={20} /> : null}
                    <Text v="small" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '600' }}>
                      {e?.team.short_name ?? tm.name}
                    </Text>
                  </Row>
                  <Text v="small" style={[st.num, { fontWeight: '800' }]}>
                    {tm.points}
                  </Text>
                  <Text v="small" dim style={st.num}>
                    {Math.round(tm.exp_points)}
                  </Text>
                  {cols.map((z) => {
                    const p = tm.zones[z.key] ?? 0;
                    const tint = z.key === 'relegation' ? t.loss : t.win;
                    return (
                      <View key={z.key} style={[st.pct, { alignItems: 'center' }]}>
                        <View style={[st.cell, { backgroundColor: alpha(tint, 0.08 + 0.5 * p) }]}>
                          <Text v="tiny" style={{ fontWeight: '800' }}>
                            {simPct(p)}
                          </Text>
                        </View>
                        <ChangeTag d={weeklyChange(tm, z.key)} bad={z.key === 'relegation'} />
                      </View>
                    );
                  })}
                </Row>
              </Pressable>
              {isOpen ? (
                <View style={{ paddingVertical: space.sm }}>
                  <PositionBars league={lg} team={tm} color={e?.team.color} />
                  <Text v="tiny" dim style={{ marginTop: space.xs }}>
                    Projected {Math.round(tm.exp_points)} points (8 in 10 simulations between {tm.points_range[0]} and {tm.points_range[1]}).{' '}
                    {lg.zones
                      .filter((z) => !cols.includes(z))
                      .map((z) => `${z.label}: ${simPct(tm.zones[z.key])}`)
                      .join(' · ')}
                  </Text>
                  {onTeam && e ? (
                    <Text v="tiny" color={t.brand} style={{ marginTop: 4, fontWeight: '700' }} onPress={() => onTeam(e.team.id)}>
                      Open team page ›
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </Glass>
      {doc.tested ? <SimTested tested={doc.tested} /> : null}
      <Text v="tiny" muted style={{ marginTop: space.sm }}>
        {doc.method} Probabilities, not certainties.
      </Text>
    </View>
  );
}

/** My Team / team page: "Arsenal: 34% title chance, ▲5 since last week". */
export function TeamForecastCard({ league, names, color }: { league: string; names: (string | null | undefined)[]; color?: string }) {
  const t = useTheme();
  const doc = useSimulations();
  const lg = simLeague(doc, league);
  const tm = lg ? matchTeam(lg.teams, names) : null;
  if (!lg || !tm) return null;
  const z = headlineZone(lg, tm);
  const d = z ? weeklyChange(tm, z.key) : null;
  const name = names.find(Boolean) ?? tm.name;
  return (
    <>
      <SectionHeader title="Season forecast" icon="chart-bell-curve" />
      <Card accessibilityLabel={z ? `${name}: ${simPct(tm.zones[z.key])} ${LONG[z.key]}` : undefined}>
        {z ? (
          <Text v="h3">
            {name}: {simPct(tm.zones[z.key])} {LONG[z.key]}
            {d != null ? (
              <Text v="h3" color={(z.key === 'relegation' ? d < 0 : d > 0) ? t.win : t.loss}>
                {`, ${d > 0 ? '▲' : '▼'}${Math.abs(d)} since last week`}
              </Text>
            ) : null}
          </Text>
        ) : null}
        <Row style={{ flexWrap: 'wrap', marginTop: space.sm }} gap={6}>
          {lg.zones.map((zz) => (
            <View key={zz.key} style={[st.zone, { borderColor: t.glassBorder, backgroundColor: alpha(zz.key === 'relegation' ? t.loss : t.win, 0.06 + 0.3 * (tm.zones[zz.key] ?? 0)) }]}>
              <Text v="tiny" muted style={{ fontWeight: '700', textTransform: 'uppercase' }}>
                {zz.label}
              </Text>
              <Row gap={4}>
                <Text v="h3">{simPct(tm.zones[zz.key])}</Text>
                <ChangeTag d={weeklyChange(tm, zz.key)} bad={zz.key === 'relegation'} />
              </Row>
            </View>
          ))}
        </Row>
        <View style={{ marginTop: space.md }}>
          <PositionBars league={lg} team={tm} color={color} />
        </View>
        <Text v="tiny" dim style={{ marginTop: space.sm }}>
          Projected {Math.round(tm.exp_points)} points (8 in 10 simulations between {tm.points_range[0]} and {tm.points_range[1]}). From {doc!.simulations.toLocaleString()} simulations of the {lg.remaining} fixtures left, updated {ago(doc!.generated_at)}.
        </Text>
      </Card>
    </>
  );
}

/** How the simulator did on finished seasons: its Brier score per zone against "the table as it stands". */
export function SimTested({ tested }: { tested: NonNullable<import('@/data/published').SimDoc['tested']> }) {
  const t = useTheme();
  const order: SimZoneKey[] = ['title', 'top4', 'europe', 'promotion', 'playoffs', 'relegation'];
  const names: Record<SimZoneKey, string> = { title: 'Title', top4: 'Top four', europe: 'Top six', promotion: 'Promotion', playoffs: 'Play-offs', relegation: 'Relegation' };
  const big = tested.calibration.filter((c) => c.from >= 0.1 && c.to <= 0.98);
  return (
    <Card style={{ marginTop: space.sm }}>
      <Text v="h3">How the forecasts held up</Text>
      <Text v="small" dim style={{ marginTop: 4 }}>
        Tested on finished seasons: simulated from {tested.period}, with the model retrained each time on earlier data only ({tested.league_seasons} league tables). Brier score, lower is better.
      </Text>
      <Row style={{ marginTop: space.sm }}>
        <Text v="tiny" muted style={{ flex: 1 }}>
          Zone
        </Text>
        <Text v="tiny" muted style={{ width: 70, textAlign: 'right' }}>
          Forecast
        </Text>
        <Text v="tiny" muted style={{ width: 92, textAlign: 'right' }}>
          Table as it stood
        </Text>
      </Row>
      {order
        .filter((k) => tested.zones[k])
        .map((k) => {
          const z = tested.zones[k]!;
          return (
            <Row key={k} style={{ paddingVertical: 3 }}>
              <Text v="small" style={{ flex: 1 }}>
                {names[k]}
              </Text>
              <Text v="small" color={z.brier < z.brier_table_now ? t.win : t.loss} style={{ width: 70, textAlign: 'right', fontWeight: '800' }}>
                {z.brier.toFixed(3)}
              </Text>
              <Text v="small" dim style={{ width: 92, textAlign: 'right' }}>
                {z.brier_table_now.toFixed(3)}
              </Text>
            </Row>
          );
        })}
      <Text v="tiny" dim style={{ marginTop: space.sm }}>
        Finishing places: ranked probability score {tested.positions.rps.toFixed(3)} against {tested.positions.rps_stays_where_it_is.toFixed(3)} for &quot;every team stays where it is&quot;.
        {big.length ? ` Calibration: ${big.map((c) => `chances given ${Math.round(c.mean_p * 100)}% happened ${Math.round(c.happened * 100)}%`).join('; ')}.` : ''}
      </Text>
    </Card>
  );
}

const st = StyleSheet.create({
  head: { paddingVertical: 6 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 4 },
  num: { width: 30, textAlign: 'center' },
  pct: { width: 46, textAlign: 'center' },
  cell: { minWidth: 40, paddingVertical: 3, borderRadius: radius.sm, alignItems: 'center' },
  zone: { minWidth: 96, flexGrow: 1, padding: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
});
