import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api/cache';
import { qs } from '@/api/client';
import type { PlayerPage } from '@/api/types';
import { Crest, PlayerPhoto } from '@/components/crest';
import { Glass } from '@/components/glass';
import { EmptyState, Icon, Loading, Row, SectionHeader, StatTile, Text } from '@/components/ui';
import { LEAGUE_BY_SLUG } from '@/data/leagues';
import { creditLine, type PlayerFacts, spellYears, usePlayerFacts, usePlayerPhoto, type Who } from '@/data/photos';
import { usePlayerSeasonXg } from '@/data/playerxg';
import { alpha, DarkSurface, LeagueTheme, radius, space, useDarkPalette, useTheme } from '@/theme/theme';

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

// season stats in the order people look for them (ESPN's own order starts with fouls)
const SEASON_ORDER = ['G', 'A', 'STRT', 'SUBIN', 'SUB', 'SHOT', 'SOG', 'SV', 'GA', 'CS', 'YC', 'RC', 'FC', 'FA', 'OFF'];
const SHORT_NAMES: Record<string, string> = { STRT: 'Starts', SUBIN: 'Sub apps', SUB: 'Sub apps', G: 'Goals', A: 'Assists', SHOT: 'Shots', SOG: 'On target', SV: 'Saves', GA: 'Conceded', CS: 'Clean sheets', YC: 'Yellow cards', RC: 'Red cards', FC: 'Fouls', FA: 'Fouled', OFF: 'Offsides' };
const ordered = (labels: string[]) => labels.map((l, i) => ({ l, i })).sort((a, b) => (SEASON_ORDER.indexOf(a.l) + 1 || 99) - (SEASON_ORDER.indexOf(b.l) + 1 || 99));

function Player({ id, league, match }: { id: string; league: string; match?: string }) {
  const t = useTheme();
  const ht = useDarkPalette(); // the header's palette (deep in both modes)
  const page = useApi<PlayerPage>(`/players/${id}${qs({ league, match })}`, { maxAge: 600, poll: match ? 30 : 0 });
  const p = page.data;
  const who: Who | null = p ? { id, name: p.name, team: p.team?.espnId ?? null, league } : null;
  const facts = usePlayerFacts(who);
  if (page.loading) return <Loading />;
  if (!p || !who) return <EmptyState icon="account-off-outline" title="Player unavailable" body={page.error} action="Retry" onAction={page.refresh} />;
  const tm = p.this_match;
  const lg = LEAGUE_BY_SLUG[league];
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const current = (lg ? p.season.find((s) => norm(s.competition).includes(norm(lg.shortName)) || norm(s.competition).includes(norm(lg.name))) : null) ?? p.season[0];
  const keeper = /goal/i.test(p.position ?? '');
  const height = facts?.h ? `${facts.h} cm` : p.height;
  const tiles: { label: string; value: string; flag?: string | null }[] = [
    ...(p.age ? [{ label: 'Age', value: String(p.age) }] : []),
    ...(height ? [{ label: 'Height', value: height }] : []),
    ...(p.nationality ? [{ label: 'Nation', value: p.nationality, flag: p.flag }] : []),
    ...(facts?.born ? [{ label: 'Born in', value: facts.born }] : []),
  ];
  const val = (s: NonNullable<typeof current>, k: string) => {
    const i = s.labels.indexOf(k);
    return i >= 0 ? s.values[i] ?? '-' : null;
  };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }}>
        {/* a deep header in both modes, with light text, so the status bar icons are light too */}
        <StatusBar style="light" />
        <LinearGradient colors={[t.heroFrom, t.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 0.3, y: 1 }}>
          <DarkSurface>
          {p.jersey ? (
            <Text v="hero" color="rgba(255,255,255,0.07)" style={{ position: 'absolute', right: -6, top: 30, fontSize: 190, lineHeight: 200 }} accessibilityElementsHidden importantForAccessibility="no">
              {p.jersey}
            </Text>
          ) : null}
          <SafeAreaView edges={['top']}>
            <View style={{ padding: space.lg }}>
              <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="chevron-down" size={26} color="#fff" />
              </Pressable>
              <Row gap={space.lg} style={{ marginTop: space.md, alignItems: 'center' }}>
                <PlayerPhoto url={p.headshot} jersey={p.jersey} color={ht.brand} size={104} ring={ht.brand} ringWidth={3} badge who={who} />
                <View style={{ flex: 1 }}>
                  <Text v="title" color="#FFFFFF" numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {p.name}
                  </Text>
                  <Row gap={6} style={{ marginTop: 4, flexWrap: 'wrap' }}>
                    {p.position ? (
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: alpha(ht.brand, 0.22), borderWidth: 1, borderColor: alpha(ht.brand, 0.6) }}>
                        <Text v="tiny" color="#FFFFFF" style={{ fontWeight: '800' }}>
                          {p.position}
                        </Text>
                      </View>
                    ) : null}
                    {p.jersey ? (
                      <Text v="small" color="rgba(255,255,255,0.85)" style={{ fontWeight: '800' }}>
                        #{p.jersey}
                      </Text>
                    ) : null}
                  </Row>
                  {p.team ? (
                    <Pressable onPress={() => router.push({ pathname: '/team/[id]', params: { id: p.team!.id, league } })} accessibilityRole="link" accessibilityLabel={`${p.team.name} team page`} style={{ marginTop: 10 }}>
                      <Row gap={6}>
                        <Crest team={{ code: p.team.name.slice(0, 3).toUpperCase(), color: '#334155', logo: p.team.logo }} size={24} />
                        <Text v="small" color="#FFFFFF" style={{ fontWeight: '800', flexShrink: 1 }} numberOfLines={1}>
                          {p.team.name}
                        </Text>
                        <Icon name="chevron-right" size={16} color="#fff" />
                      </Row>
                    </Pressable>
                  ) : null}
                </View>
              </Row>
              {tiles.length ? (
                // two per row, so a long place name ("Székesfehérvár") or country fits; an odd one out spans the row
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg }}>
                  {tiles.map((x) => (
                    <View key={x.label} style={{ flexGrow: 1, flexBasis: '40%', minWidth: 0, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                      <Text v="tiny" color="rgba(255,255,255,0.7)" style={{ fontWeight: '700', textTransform: 'uppercase' }}>
                        {x.label}
                      </Text>
                      <Row gap={5} style={{ marginTop: 2 }}>
                        {x.flag ? <Image source={{ uri: x.flag }} style={{ width: 18, height: 12, borderRadius: 2 }} contentFit="cover" /> : null}
                        <Text v="small" color="#FFFFFF" style={{ fontWeight: '800', flexShrink: 1 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                          {x.value}
                        </Text>
                      </Row>
                    </View>
                  ))}
                </View>
              ) : null}
              <PhotoCredit who={who} />
            </View>
          </SafeAreaView>
          </DarkSurface>
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
                  {tm.xg ? ` · ${tm.xg.toFixed(2)} xG from his shots` : ''}
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
                <Row gap={space.sm}>
                  {(keeper ? ['SV', 'GA'] : ['G', 'A']).map((k) =>
                    val(current, k) !== null ? (
                      <View key={k} style={{ flex: 1, padding: space.md, borderRadius: radius.md, backgroundColor: alpha(t.brand, 0.1), borderWidth: 1, borderColor: alpha(t.brand, 0.35) }}>
                        <Text v="tiny" muted style={{ fontWeight: '800', textTransform: 'uppercase' }}>
                          {SHORT_NAMES[k]}
                        </Text>
                        <Text v="hero" color={t.brand} style={{ fontSize: 44, lineHeight: 48 }}>
                          {val(current, k)}
                        </Text>
                      </View>
                    ) : null,
                  )}
                </Row>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.sm }}>
                  {ordered(current.labels)
                    .filter(({ l }) => !(keeper ? ['SV', 'GA'] : ['G', 'A']).includes(l))
                    .map(({ l, i }) => (
                      <View key={l} style={{ width: '33.33%', paddingVertical: 8, paddingRight: 6 }}>
                        <Text v="h2" style={{ fontSize: 22, lineHeight: 25 }}>
                          {current.values[i] ?? '-'}
                        </Text>
                        <Text v="tiny" muted numberOfLines={1}>
                          {SHORT_NAMES[l] ?? current.names[i] ?? l}
                        </Text>
                      </View>
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
                  const g = Number(r.stats.find((s) => /goal/i.test(s.label))?.value ?? 0) || 0;
                  const a = Number(r.stats.find((s) => /assist/i.test(s.label))?.value ?? 0) || 0;
                  return (
                    <Row key={r.eventId} gap={10} style={{ paddingHorizontal: space.lg, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: t.glassBorder }}>
                      <View style={{ width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: r.result === 'W' ? t.win : r.result === 'L' ? t.loss : r.result === 'D' ? t.draw : alpha(t.text, 0.2) }}>
                        <Text v="tiny" color="#fff" style={{ fontWeight: '900' }}>
                          {r.result ?? '-'}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text v="small" style={{ fontWeight: '700' }} numberOfLines={1}>
                          {r.home ? 'vs' : '@'} {r.opponent} <Text v="small" dim>{r.score}</Text>
                        </Text>
                        <Text v="tiny" muted numberOfLines={1}>
                          {[r.date ? new Date(r.date).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null, r.competition].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      {g ? (
                        <View style={[contrib, { backgroundColor: alpha(t.brand, 0.16) }]}>
                          <Icon name="soccer" size={13} color={t.brand} />
                          {g > 1 ? <Text v="tiny" style={{ fontWeight: '900' }}>{g}</Text> : null}
                        </View>
                      ) : null}
                      {a ? (
                        <View style={[contrib, { backgroundColor: alpha(t.win, 0.16) }]}>
                          <Text v="tiny" color={t.win} style={{ fontWeight: '900' }}>
                            {a > 1 ? `${a} A` : 'A'}
                          </Text>
                        </View>
                      ) : null}
                    </Row>
                  );
                })}
              </Glass>
            </>
          ) : null}

          {facts && (facts.clubs.length || facts.nt) ? <Career facts={facts} /> : null}

          {p.season.length > 1 ? (
            <>
              <SectionHeader title="All competitions" icon="trophy-outline" />
              <Glass padded={false}>
                <Row style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: 4 }}>
                  <Text v="tiny" muted style={{ flex: 1 }}>
                    Competition
                  </Text>
                  {(keeper ? ['STRT', 'SV', 'GA', 'YC'] : ['STRT', 'G', 'A', 'YC']).map((k) => (
                    <Text key={k} v="tiny" muted style={{ width: 40, textAlign: 'center' }}>
                      {k === 'STRT' ? 'Starts' : k === 'YC' ? 'YC' : k === 'SV' ? 'Saves' : k}
                    </Text>
                  ))}
                </Row>
                {p.season.map((s, i) => (
                  <Row key={s.competition} style={{ paddingHorizontal: space.lg, paddingVertical: 10, borderTopWidth: 1, borderColor: t.glassBorder }}>
                    <Text v="small" style={{ flex: 1, fontWeight: '700' }} numberOfLines={2}>
                      {s.competition.replace(/^\d{4}(-\d{2})?\s+/, '')}
                    </Text>
                    {(keeper ? ['STRT', 'SV', 'GA', 'YC'] : ['STRT', 'G', 'A', 'YC']).map((k) => (
                      <Text key={k} v="mono" style={{ width: 40, textAlign: 'center', fontSize: 14 }} color={k === 'G' && Number(val(s, k)) > 0 ? t.brand : undefined}>
                        {val(s, k) ?? '-'}
                      </Text>
                    ))}
                  </Row>
                ))}
              </Glass>
            </>
          ) : null}
          <Text v="tiny" muted style={{ marginTop: space.lg }}>
            Player data: ESPN.{facts ? ' Height, birthplace and career: Wikidata (CC0), edited by volunteers; checked for obvious slips but not guaranteed.' : ''}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const contrib = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2, paddingHorizontal: 7, height: 22, borderRadius: 11 };

/** Senior career from Wikidata: clubs with years, loans marked, and the senior national team. */
function Career({ facts }: { facts: PlayerFacts }) {
  const t = useTheme();
  const clubs = [...facts.clubs].reverse(); // newest first
  return (
    <>
      <SectionHeader title="Career" icon="timeline-outline" />
      <Glass padded={false}>
        {facts.nt ? (
          <Row gap={10} style={{ paddingHorizontal: space.lg, paddingVertical: 10 }}>
            <Icon name="flag-variant" size={18} color={t.accent2} />
            <Text v="small" style={{ flex: 1, fontWeight: '800' }}>
              {facts.nt[0]} national team
            </Text>
            <Text v="small" dim>
              since {facts.nt[1]}
            </Text>
          </Row>
        ) : null}
        {clubs.map((c, i) => (
          <Row key={`${c[0]}-${c[1]}-${i}`} gap={10} style={{ paddingHorizontal: space.lg, paddingVertical: 10, borderTopWidth: i || facts.nt ? 1 : 0, borderColor: t.glassBorder }}>
            <View style={{ width: 10, alignItems: 'center' }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c[2] === null ? t.brand : alpha(t.text, 0.25) }} />
            </View>
            <Text v="small" style={{ flex: 1, fontWeight: c[2] === null ? '800' : '600' }} numberOfLines={1}>
              {c[0]}
            </Text>
            {c[3] ? (
              <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: alpha(t.pending, 0.16) }}>
                <Text v="tiny" color={t.pending} style={{ fontWeight: '800' }}>
                  loan
                </Text>
              </View>
            ) : null}
            <Text v="small" dim style={{ minWidth: 64, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
              {spellYears(c)}
            </Text>
          </Row>
        ))}
      </Glass>
    </>
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

export { ErrorBoundary } from '@/components/route-error';
