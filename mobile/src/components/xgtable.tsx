/** Stats > xG table: the league ranked by the points each team's chances were worth. */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useXgTable, xgTableToFetch } from '@/data/xgtable';
import { usePrefs } from '@/state/prefs';
import { alpha, space, useTheme } from '@/theme/theme';

import { Glass } from './glass';
import { TeamBadge } from './match';
import { Button, Card, EmptyState, Row, Text } from './ui';

export function XgTableView({ league, onTeam }: { league: string; onTeam?: (id: string) => void }) {
  const t = useTheme();
  const { prefs } = usePrefs();
  const [go, setGo] = useState(!prefs.dataSaver);
  const [toFetch, setToFetch] = useState<number | null>(null);
  useEffect(() => {
    setGo(!prefs.dataSaver);
    if (prefs.dataSaver) void xgTableToFetch(league).then(setToFetch).catch(() => setToFetch(null));
  }, [league, prefs.dataSaver]);
  const x = useXgTable(league, go);
  if (!go)
    return (
      <Card>
        <Text v="h3">xG table</Text>
        <Text v="small" dim style={{ marginTop: 4 }}>
          Data saver is on. Building the table downloads the match report of every league match this season once
          {toFetch != null ? ` (${toFetch} still to download)` : ''}; after that only new matches are fetched.
        </Text>
        <View style={{ marginTop: space.md }}>
          <Button title="Build the xG table" icon="download" onPress={() => setGo(true)} />
        </View>
      </Card>
    );
  if (x.loading)
    return (
      <Card>
        <Text v="h3">Working out the xG table…</Text>
        <Text v="small" dim style={{ marginTop: 4 }}>
          {x.total ? `${x.done} of ${x.total} matches` : 'Loading this season’s matches'} (each match is downloaded only once)
        </Text>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: alpha(t.text, 0.08), marginTop: space.md, overflow: 'hidden' }}>
          <View style={{ height: 6, width: `${x.total ? (100 * x.done) / x.total : 4}%`, backgroundColor: t.brand }} />
        </View>
      </Card>
    );
  if (!x.data || !x.data.rows.length) return <EmptyState icon="target" title="No xG table yet" body="It needs finished league matches with shot positions this season." />;
  const d = x.data;
  return (
    <View>
      <Card>
        <Text v="h3">Who deserved what</Text>
        <Text v="small" dim style={{ marginTop: 4 }}>
          Ranked by expected points (xPts): how many points each team&apos;s chances were worth, match by match. A team well above its xPts has been lucky or clinical; one well below is due to improve if it keeps creating the same chances.
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
          {['xPts', 'Pts', '±', 'xG', 'xGA'].map((h) => (
            <Text key={h} v="tiny" muted style={st.num}>
              {h}
            </Text>
          ))}
        </Row>
        {d.rows.map((r, i) => {
          const diff = r.points - r.xpts;
          const tint = Math.abs(diff) < 2 ? t.textDim : diff > 0 ? t.pending : t.brand;
          return (
            <View
              key={r.team.id}
              style={[st.row, { borderColor: t.glassBorder, flexDirection: 'row', alignItems: 'center', gap: 2 }]}
              accessible
              accessibilityLabel={`${r.team.name}: ${r.xpts.toFixed(1)} expected points, ${r.points} actual, from ${r.matches} matches`}
            >
              <Text v="small" dim style={{ width: 22, fontWeight: '700' }}>
                {i + 1}
              </Text>
              <Row style={{ flex: 1 }} gap={6}>
                <TeamBadge team={{ id: r.team.id, name: r.team.name, short_name: r.team.short_name, code: r.team.short_name.slice(0, 3).toUpperCase(), color: r.team.color, logo: r.team.logo }} size={20} />
                <Text v="small" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '600' }} onPress={onTeam ? () => onTeam(r.team.id) : undefined}>
                  {r.team.short_name}
                </Text>
              </Row>
              <Text v="small" style={[st.num, { fontWeight: '800' }]}>
                {r.xpts.toFixed(1)}
              </Text>
              <Text v="small" style={st.num}>
                {r.points}
              </Text>
              <Text v="small" color={tint} style={[st.num, { fontWeight: '800' }]}>
                {diff >= 0 ? '+' : '−'}
                {Math.abs(diff).toFixed(1)}
              </Text>
              <Text v="small" dim style={st.num}>
                {r.xgFor.toFixed(1)}
              </Text>
              <Text v="small" dim style={st.num}>
                {r.xgAgainst.toFixed(1)}
              </Text>
            </View>
          );
        })}
      </Glass>
      <Text v="tiny" muted style={{ marginTop: space.sm }}>
        From {d.used} of {d.total} league matches this season{d.skipped ? ` (${d.skipped} left out: shot positions missing)` : ''}. Pts counts the same matches. xG is MK Sports&apos; own estimate from where each shot was taken; the data doesn&apos;t say whether a shot was a header.
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  head: { paddingVertical: 6 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, minHeight: 40 },
  num: { width: 38, textAlign: 'center' },
});
