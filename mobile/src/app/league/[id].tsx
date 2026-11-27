import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, View } from 'react-native';

import { useApi } from '@/api/cache';
import { qs } from '@/api/client';
import { usePaged } from '@/api/paged';
import type { League, Leaders, MatchCard, StandingRow } from '@/api/types';
import { Backdrop, Glass, Hero } from '@/components/glass';
import { MatchRow, StandingsTable } from '@/components/match';
import { LeadersView } from '@/components/sportviews';
import { EmptyState, Loading, Segmented, StatusBanner, Text } from '@/components/ui';
import { LEAGUE_BY_SLUG } from '@/data/leagues';
import { usePrefs } from '@/state/prefs';
import { LeagueTheme, space, useTheme } from '@/theme/theme';

type Tab = 'fixtures' | 'results' | 'table' | 'players';

export default function LeagueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <LeagueTheme league={id}>
      <LeagueView id={id} />
    </LeagueTheme>
  );
}

function LeagueView({ id }: { id: string }) {
  const t = useTheme();
  const { prefs } = usePrefs();
  const def = LEAGUE_BY_SLUG[id];
  const [tab, setTab] = useState<Tab>(def?.kind === 'cup' ? 'fixtures' : 'table');
  const league = useApi<League>(`/leagues/${id}`, { maxAge: 300 });
  // midnight today (stable for the whole day, so the cached first page is reused)
  const from = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const listPath = tab === 'fixtures' ? `/matches${qs({ league_id: id, from, order: 'asc', limit: 30 })}` : tab === 'results' ? `/matches${qs({ league_id: id, status: 'finished', order: 'desc', limit: 30 })}` : null;
  const matches = usePaged<MatchCard>(listPath, { maxAge: 60, poll: tab === 'fixtures' && !prefs.dataSaver ? 60 : 0 });
  const table = useApi<StandingRow[]>(tab === 'table' ? `/leagues/${id}/standings` : null, { maxAge: 300 });
  const leaders = useApi<Leaders>(tab === 'players' ? `/leagues/${id}/leaders` : null, { maxAge: 3600 });

  if (league.loading) return <Loading />;
  const lg = league.data;
  const sport = lg?.sport ?? def?.sport ?? 'football';
  const header = (
    <View style={{ gap: space.md, marginBottom: space.md }}>
      <Stack.Screen options={{ title: lg?.short_name ?? 'League', headerTransparent: false }} />
      <Hero>
        <Text v="label" color="rgba(255,255,255,0.8)">
          {[lg?.country ?? lg?.region, lg?.season ? `Season ${lg.season}` : null].filter(Boolean).join(' · ')}
        </Text>
        <Text v="h2" color="#FFFFFF" style={{ marginTop: 2 }}>
          {lg?.name}
        </Text>
      </Hero>
      <Segmented
        options={[
          { value: 'table', label: 'Table' },
          { value: 'fixtures', label: 'Fixtures' },
          { value: 'results', label: 'Results' },
          ...(def?.leaders || sport === 'football' ? [{ value: 'players' as Tab, label: 'Players' }] : []),
        ]}
        value={tab}
        onChange={setTab}
      />
      <StatusBanner error={matches.error ?? table.error ?? leaders.error} offline={matches.offline || table.offline} onRetry={() => (tab === 'table' ? table.refresh() : tab === 'players' ? leaders.refresh() : matches.refresh())} />
    </View>
  );

  if (tab === 'table' || tab === 'players') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Backdrop />
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}>
          {header}
          {tab === 'players' ? (
            leaders.loading ? <ActivityIndicator color={t.brand} /> : leaders.data ? <LeadersView categories={leaders.data.categories} league={id} /> : null
          ) : table.loading ? (
            <ActivityIndicator color={t.brand} />
          ) : table.data?.length ? (
            <Glass>
              <StandingsTable rows={table.data} sport={sport} highlight={prefs.favoriteTeam ? [prefs.favoriteTeam.id] : []} onTeam={(tm) => router.push({ pathname: '/team/[id]', params: { id: tm.id, league: id } })} />
            </Glass>
          ) : (
            <EmptyState icon="table-large" title="No table" body={def?.kind === 'cup' ? 'Knockout competitions have no league table; see Fixtures and Results.' : 'Standings appear once matches have been played.'} />
          )}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Backdrop />
      <FlatList
        data={matches.items}
        keyExtractor={(m) => String(m.id)}
        renderItem={({ item }) => <MatchRow m={item} showLeague={false} />}
        ListHeaderComponent={header}
        ListEmptyComponent={matches.loading ? <ActivityIndicator color={t.brand} /> : <EmptyState title={tab === 'fixtures' ? 'No upcoming fixtures' : 'No results yet'} body={tab === 'fixtures' ? 'This competition may be between seasons or rounds.' : undefined} />}
        ListFooterComponent={matches.loadingMore ? <ActivityIndicator color={t.brand} style={{ margin: space.md }} /> : undefined}
        onEndReached={matches.loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ padding: space.lg }}
        initialNumToRender={8}
        windowSize={7}
        removeClippedSubviews
      />
    </View>
  );
}

export { ErrorBoundary } from '@/components/route-error';
