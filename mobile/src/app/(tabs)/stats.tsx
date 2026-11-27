import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api/cache';
import { qs } from '@/api/client';
import { usePaged } from '@/api/paged';
import type { F1Board, F1Standing, Leaders, MatchCard, RankRow, StandingRow } from '@/api/types';
import { Backdrop, Glass, Hero } from '@/components/glass';
import { ForecastTable } from '@/components/forecast';
import { MatchRow, StandingsTable } from '@/components/match';
import { F1StandingsView, F1View, LeadersView, RankingsView } from '@/components/sportviews';
import { XgTableView } from '@/components/xgtable';
import { Chip, ChipRow, EmptyState, Row, Segmented, StatusBanner, Text } from '@/components/ui';
import { LEAGUE_BY_SLUG, LEAGUES } from '@/data/leagues';
import { usePrefs } from '@/state/prefs';
import { LeagueTheme, space, TAB_BAR_SPACE, useTheme } from '@/theme/theme';

type Tab = 'table' | 'forecast' | 'xg' | 'fixtures' | 'results' | 'players' | 'drivers' | 'constructors' | 'races' | 'rankings';

export default function StatsScreen() {
  const { prefs } = usePrefs();
  const [league, setLeague] = useState<string>(prefs.favoriteTeam?.leagues[0] ?? prefs.leagues.find((l) => LEAGUE_BY_SLUG[l]) ?? 'eng.1');
  return (
    <LeagueTheme league={league}>
      <Stats league={league} setLeague={setLeague} />
    </LeagueTheme>
  );
}

function Stats({ league, setLeague }: { league: string; setLeague: (l: string) => void }) {
  const t = useTheme();
  const { prefs } = usePrefs();
  const lg = LEAGUE_BY_SLUG[league];
  const tabs: { value: Tab; label: string }[] =
    lg.format === 'racing'
      ? [
          { value: 'drivers', label: 'Drivers' },
          { value: 'constructors', label: 'Constructors' },
          { value: 'races', label: 'Race weekend' },
        ]
      : lg.format === 'tennis'
        ? [{ value: 'rankings', label: 'Rankings' }]
        : [
            { value: 'table', label: 'Table' },
            ...(lg.sport === 'football' && lg.kind !== 'cup' ? [{ value: 'forecast' as Tab, label: 'Forecast' }, { value: 'xg' as Tab, label: 'xG table' }] : []),
            { value: 'fixtures', label: 'Fixtures' },
            { value: 'results', label: 'Results' },
            ...(lg.leaders || lg.sport === 'football' ? [{ value: 'players' as Tab, label: lg.sport === 'football' ? 'Player stats' : 'Leaders' }] : []),
          ];
  const [tabRaw, setTab] = useState<Tab>('table');
  const tab = tabs.some((x) => x.value === tabRaw) ? tabRaw : tabs[0].value;

  const order = useMemo(() => {
    const mine = [...new Set([...(prefs.favoriteTeam?.leagues ?? []), ...prefs.leagues])].filter((l) => LEAGUE_BY_SLUG[l] && LEAGUE_BY_SLUG[l].format !== 'cricket');
    return [...mine, ...LEAGUES.filter((l) => !mine.includes(l.slug) && l.format !== 'cricket').map((l) => l.slug)];
  }, [prefs.favoriteTeam, prefs.leagues]);

  const from = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const isMatch = lg.format === 'match';
  const table = useApi<StandingRow[]>(isMatch && (tab === 'table' || tab === 'forecast') ? `/leagues/${league}/standings` : null, { maxAge: 300 });
  const list = usePaged<MatchCard>(
    isMatch && (tab === 'fixtures' || tab === 'results') ? `/matches${qs(tab === 'fixtures' ? { league_id: league, from, order: 'asc', limit: 30 } : { league_id: league, status: 'finished', order: 'desc', limit: 30 })}` : null,
    { maxAge: 60, poll: tab === 'fixtures' && !prefs.dataSaver ? 60 : 0 },
  );
  const leaders = useApi<Leaders>(isMatch && tab === 'players' ? `/leagues/${league}/leaders` : null, { maxAge: 3600 });
  const f1s = useApi<{ drivers: F1Standing[]; constructors: F1Standing[] }>(lg.format === 'racing' && tab !== 'races' ? '/f1/standings' : null, { maxAge: 3600 });
  const f1b = useApi<F1Board>(lg.format === 'racing' && tab === 'races' ? '/f1' : null, { maxAge: 120 });
  const ranks = useApi<RankRow[]>(lg.format === 'tennis' ? `/tennis/${league}/rankings` : null, { maxAge: 6 * 3600 });
  const active = table.data !== undefined ? table : leaders.data !== undefined ? leaders : f1s.data !== undefined ? f1s : ranks;
  const loading = table.loading || list.loading || leaders.loading || f1s.loading || f1b.loading || ranks.loading;
  const err = table.error ?? list.error ?? leaders.error ?? f1s.error ?? f1b.error ?? ranks.error;

  const body = () => {
    if (loading && !list.items.length && tab !== 'forecast') return <ActivityIndicator color={t.brand} style={{ marginTop: space.xl }} />;
    if (tab === 'table')
      return table.data?.length ? (
        <Glass>
          <StandingsTable rows={table.data} sport={lg.sport} highlight={prefs.favoriteTeam ? [prefs.favoriteTeam.id] : []} onTeam={(tm) => router.push({ pathname: '/team/[id]', params: { id: tm.id, league } })} />
        </Glass>
      ) : (
        <EmptyState icon="table-large" title="No table" body={lg.kind === 'cup' ? 'Knockout competitions have no league table; see Fixtures and Results.' : 'Standings appear once matches have been played.'} />
      );
    if (tab === 'forecast') return <ForecastTable league={league} rows={table.data} onTeam={(id) => router.push({ pathname: '/team/[id]', params: { id, league } })} />;
    if (tab === 'xg') return <XgTableView league={league} onTeam={(id) => router.push({ pathname: '/team/[id]', params: { id: `football:${id}`, league } })} />;
    if (tab === 'fixtures' || tab === 'results')
      return list.items.length ? (
        <View>
          {list.items.map((m) => (
            <MatchRow key={m.id} m={m} showLeague={false} />
          ))}
          {list.hasMore ? <Chip label={list.loadingMore ? 'Loading…' : 'Load more'} onPress={list.loadMore} /> : null}
        </View>
      ) : (
        <EmptyState title={tab === 'fixtures' ? 'No upcoming fixtures' : 'No results yet'} />
      );
    if (tab === 'players') return leaders.data ? <LeadersView categories={leaders.data.categories} league={league} /> : null;
    if (tab === 'drivers') return f1s.data ? <F1StandingsView rows={f1s.data.drivers} /> : null;
    if (tab === 'constructors') return f1s.data ? <F1StandingsView rows={f1s.data.constructors} team /> : null;
    if (tab === 'races') return f1b.data ? <F1View board={f1b.data} /> : null;
    if (tab === 'rankings') return ranks.data ? <RankingsView rows={ranks.data} /> : null;
    return null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Backdrop />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: TAB_BAR_SPACE + space.lg }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => (tab === 'fixtures' || tab === 'results' ? list.refresh() : active.refresh())} tintColor={t.brand} />}
          onScroll={({ nativeEvent: e }) => {
            if ((tab === 'fixtures' || tab === 'results') && e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 400) list.loadMore();
          }}
          scrollEventThrottle={250}
        >
          <Row style={{ justifyContent: 'space-between', paddingTop: space.md }}>
            <Text v="title">Stats</Text>
          </Row>
          <ChipRow>
            {order.map((slug) => {
              const l = LEAGUE_BY_SLUG[slug];
              return (
                <Chip
                  key={slug}
                  label={l.shortName}
                  color={l.theme.accent}
                  selected={slug === league}
                  onPress={() => setLeague(slug)}
                  left={<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: l.theme.primary, borderWidth: 2, borderColor: l.theme.accent }} />}
                />
              );
            })}
          </ChipRow>
          <Hero style={{ marginTop: space.md }}>
            <Text v="label" color="rgba(255,255,255,0.8)">
              {lg.region}
              {lg.country ? ` · ${lg.country}` : ''}
            </Text>
            <Text v="h2" color="#FFFFFF" style={{ marginTop: 2 }}>
              {lg.name}
            </Text>
            <View style={{ marginTop: space.md }}>
              <Segmented scroll options={tabs} value={tab} onChange={setTab} />
            </View>
          </Hero>
          <StatusBanner error={err} onRetry={() => active.refresh()} />
          <View style={{ marginTop: space.md }}>{body()}</View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export { ErrorBoundary } from '@/components/route-error';
