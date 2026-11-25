import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api/cache';
import { qs } from '@/api/client';
import type { PlayerPage } from '@/api/types';
import { Crest, PlayerPhoto } from '@/components/crest';
import { Glass } from '@/components/glass';
import { EmptyState, Icon, Loading, Row, SectionHeader, StatTile, Text } from '@/components/ui';
import { LEAGUE_BY_SLUG } from '@/data/leagues';
import { creditLine, usePlayerPhoto, type Who } from '@/data/photos';
import { usePlayerSeasonXg } from '@/data/playerxg';
import { alpha, LeagueTheme, space, useTheme } from '@/theme/theme';

const MATCH_KEYS: [string, string][] = [
  ['G', 'Goals'],
  ['A', 'Assists'],
  ['SHOT', 'Shots'],
  ['SOG', 'On target'],
  ['FC', 'Fouls'],
  ['FA', 'Fouled'],
  ['OFF', 'Offsides'],
  ['SV', 'Saves'],
  ['GA', 'Conceded'],
  ['YC', 'Yellow'],
  ['RC', 'Red'],
];

export default function PlayerScreen() {
  const { id, league, match } = useLocalSearchParams<{ id: string; league: string; match?: string }>();
  return (
    <LeagueTheme league={league}>
      <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
      <Player id={id} league={league} match={match} />
    </LeagueTheme>
  );
}

function Player({ id, league, match }: { id: string; league: string; match?: string }) {
  const t = useTheme();
  const page = useApi<PlayerPage>(`/players/${id}${qs({ league, match })}`, { maxAge: 600, poll: match ? 30 : 0 });
  const p = page.data;
  if (page.loading) return <Loading />;
  if (!p) return <EmptyState icon="account-off-outline" title="Player unavailable" body={page.error} action="Retry" onAction={page.refresh} />;
  const tm = p.this_match;
  const lg = LEAGUE_BY_SLUG[league];
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const current = (lg ? p.season.find((s) => norm(s.competition).includes(norm(lg.shortName)) || norm(s.competition).includes(norm(lg.name))) : null) ?? p.season[0];
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
        <LinearGradient colors={[t.heroFrom, t.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 0.3, y: 1 }}>
          <SafeAreaView edges={['top']}>
            <View style={{ padding: space.lg }}>
              <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="chevron-down" size={26} color="#fff" />
              </Pressable>
              <Row gap={space.lg} style={{ marginTop: space.md }}>
                <PlayerPhoto url={p.headshot} jersey={p.jersey} color={t.brand} size={88} ring="#FFFFFF" who={{ id, name: p.name, team: p.team?.espnId ?? null, league }} />
                <View style={{ flex: 1 }}>
                  <Text v="title" color="#FFFFFF">
                    {p.name}
                  </Text>
                  <Text v="small" color="rgba(255,255,255,0.85)">
                    {[p.position, p.jersey ? `#${p.jersey}` : null, p.age ? `${p.age} yrs` : null, p.height].filter(Boolean).join(' · ')}
                  </Text>
                  <Row gap={8} style={{ marginTop: 8 }}>
                    {p.flag ? <Image source={{ uri: p.flag }} style={{ width: 22, height: 15, borderRadius: 2 }} contentFit="cover" /> : null}
                    <Text v="small" color="#FFFFFF">
                      {p.nationality}
                    </Text>
                  </Row>
              <PhotoCredit who={{ id, name: p.name, team: p.team?.espnId ?? null, league }} />
                  {p.team ? (
                    <Pressable onPress={() => router.push({ pathname: '/team/[id]', params: { id: p.team!.id, league } })} accessibilityRole="link" style={{ marginTop: 8 }}>
                      <Row gap={6}>
                        <Crest team={{ code: p.team.name.slice(0, 3).toUpperCase(), color: '#334155', logo: p.team.logo }} size={24} />
                        <Text v="small" color="#FFFFFF" style={{ fontWeight: '800' }}>
                          {p.team.name}
                        </Text>
                        <Icon name="chevron-right" size={16} color="#fff" />
                      </Row>
                    </Pressable>
                  ) : null}
                </View>
              </Row>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={{ paddingHorizontal: space.lg }}>
          {tm ? (
            <>
              <SectionHeader title="This match" icon="whistle" />
              <Glass>
                <Text v="small" dim style={{ marginBottom: space.sm }}>
                  {tm.starter ? 'Started' : tm.subbedIn !== null ? `Came on ${tm.subbedIn}` : 'On the bench'}
                  {tm.subbedOut !== null ? ` · off ${tm.subbedOut}` : ''}
                  {tm.positionName ? ` · ${tm.positionName}` : ''}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {MATCH_KEYS.filter(([k]) => tm.stats[k] !== undefined && (tm.stats[k] > 0 || ['G', 'A', 'SHOT', 'SOG'].includes(k))).map(([k, label]) => (
                    <StatTile key={k} label={label} value={String(tm.stats[k])} color={k === 'G' && tm.stats[k] ? t.brand : k === 'RC' ? t.live : undefined} />
                  ))}
                </View>
              </Glass>
            </>
          ) : null}

          {current ? (
            <>
              <SectionHeader title={`Season · ${current.competition}`} icon="chart-box-outline" />
              <Glass>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {current.labels.map((l, i) => (
                    <StatTile key={l} label={current.names[i] ?? l} value={current.values[i] ?? '-'} />
                  ))}
                </View>
              </Glass>
            </>
          ) : null}

          {lg?.sport === 'football' && p.team ? <PlayerXg league={league} team={p.team.espnId} id={id} /> : null}

          {p.recent.length ? (
            <>
              <SectionHeader title="Recent form · last 5" icon="chart-timeline-variant" />
              <Glass padded={false}>
                {p.recent.map((r, i) => {
                  const g = r.stats.find((s) => /goal/i.test(s.label))?.value;
                  const a = r.stats.find((s) => /assist/i.test(s.label))?.value;
                  const app = r.stats.find((s) => /appear/i.test(s.label))?.value;
                  return (
                    <Row key={r.eventId} gap={10} style={{ paddingHorizontal: space.lg, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: t.glassBorder }}>
                      <View style={{ width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: r.result === 'W' ? t.win : r.result === 'L' ? t.loss : r.result === 'D' ? t.draw : alpha(t.text, 0.2) }}>
                        <Text v="tiny" color="#fff" style={{ fontWeight: '900' }}>
                          {r.result ?? '-'}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text v="small" style={{ fontWeight: '700' }} numberOfLines={1}>
                          {r.home ? 'vs' : '@'} {r.opponent} <Text v="small" dim>{r.score}</Text>
                        </Text>
                        <Text v="tiny" muted numberOfLines={1}>
                          {[r.date ? new Date(r.date).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null, r.competition, app && app !== '1' && app !== 'Started' ? app : null].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      {g !== undefined ? (
                        <Row gap={2}>
                          <Icon name="soccer" size={14} color={Number(g) ? t.brand : t.textMuted} />
                          <Text v="mono">{g}</Text>
                        </Row>
                      ) : null}
                      {a !== undefined ? (
                        <Text v="mono" dim style={{ minWidth: 28, textAlign: 'right' }}>
                          A{a}
                        </Text>
                      ) : null}
                    </Row>
                  );
                })}
              </Glass>
            </>
          ) : null}

          {p.season.length > 1 ? (
            <>
              <SectionHeader title="All competitions" icon="trophy-outline" />
              <Glass padded={false}>
                {p.season.map((s, i) => (
                  <View key={s.competition} style={{ paddingHorizontal: space.lg, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: t.glassBorder }}>
                    <Text v="small" style={{ fontWeight: '700' }}>
                      {s.competition}
                    </Text>
                    <Text v="tiny" dim>
                      {s.labels.map((l, k) => `${l} ${s.values[k] ?? '-'}`).join(' · ')}
                    </Text>
                  </View>
                ))}
              </Glass>
            </>
          ) : null}
          <Text v="tiny" muted style={{ marginTop: space.lg }}>
            Player data: ESPN.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/** Wikimedia Commons photos are credited where they are shown large (their licences ask for attribution). */
function PhotoCredit({ who }: { who: Who }) {
  const photo = usePlayerPhoto(who);
  if (!photo) return null;
  return (
    <Text v="tiny" color="rgba(255,255,255,0.7)" style={{ marginTop: space.sm }} numberOfLines={2}>
      {creditLine(photo)}
    </Text>
  );
}

/** Season xG from shot positions: MK Sports' own estimate (data/playerxg.ts). */
function PlayerXg({ league, team, id }: { league: string; team: string; id: string }) {
  const t = useTheme();
  const x = usePlayerSeasonXg(league, team, id);
  const lg = LEAGUE_BY_SLUG[league];
  if (!x.loading && (!x.data || x.data.matches === 0)) return null;
  const d = x.data;
  const diff = d ? d.goals - d.xg : 0;
  return (
    <>
      <SectionHeader title={`Expected goals · ${lg?.shortName ?? 'this season'}`} icon="target" />
      <Glass>
        {x.loading || !d ? (
          <Text v="small" dim>
            Working out from this season's matches{x.total ? ` (${x.done} of ${x.total})` : ''}…
          </Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <StatTile label="xG" value={d.xg.toFixed(2)} color={t.brand} />
              <StatTile label="xG per 90" value={d.xgPer90 !== null ? d.xgPer90.toFixed(2) : '-'} />
              <StatTile label="Non-penalty xG" value={d.npxg.toFixed(2)} />
              <StatTile label="Goals" value={String(d.goals)} sub={d.shots ? `from ${d.shots} shots` : undefined} />
              <StatTile label="Goals − xG" value={`${diff >= 0 ? '+' : ''}${diff.toFixed(2)}`} color={Math.abs(diff) < 0.5 ? undefined : diff > 0 ? t.win : t.loss} />
              <StatTile label="Minutes" value={String(Math.round(d.minutes))} />
            </View>
            <Text v="tiny" muted style={{ marginTop: space.sm }}>
              MK Sports' own estimate from shot positions, not an official figure. From {d.matches} {d.matches === 1 ? 'match' : 'matches'} this season
              {d.skipped ? `; ${d.skipped} left out because the feed had no shot positions` : ''}. "Goals − xG" above zero means finishing better than the chances suggest.
            </Text>
          </>
        )}
      </Glass>
    </>
  );
}
