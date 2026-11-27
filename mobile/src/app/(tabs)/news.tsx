import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api/cache';
import { qs } from '@/api/client';
import type { Article, MatchCard, NewsFeed } from '@/api/types';
import { ArticleRow, MatchStrip } from '@/components/feed';
import { Backdrop } from '@/components/glass';
import { EmptyState, Icon, Row, SectionHeader, Segmented, StatusBanner, Text } from '@/components/ui';
import { LEAGUE_BY_SLUG, LEAGUES } from '@/data/leagues';
import { usePrefs } from '@/state/prefs';
import { LeagueTheme, space, TAB_BAR_SPACE, useTheme } from '@/theme/theme';

export default function NewsScreen() {
  const { prefs } = usePrefs();
  const [tab, setTab] = useState<string>('top');
  return (
    <LeagueTheme league={tab !== 'top' && tab !== 'mine' ? tab : prefs.favoriteTeam && tab === 'mine' ? prefs.favoriteTeam.leagues[0] : null}>
      <News tab={tab} setTab={setTab} />
    </LeagueTheme>
  );
}

function News({ tab, setTab }: { tab: string; setTab: (t: string) => void }) {
  const t = useTheme();
  const { prefs } = usePrefs();
  const fav = prefs.favoriteTeam;
  const myLeagues = useMemo(() => {
    const mine = [...new Set([...prefs.leagues, ...(fav?.leagues ?? [])])].filter((l) => LEAGUE_BY_SLUG[l]);
    return mine.length ? mine : LEAGUES.filter((l) => l.featured).map((l) => l.slug);
  }, [prefs.leagues, fav]);
  const tabs = useMemo(() => {
    const extra = ['eng.1', 'esp.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf', 'ita.1', 'ger.1', 'fra.1', 'ned.1', 'por.1', 'tur.1', 'nba', 'nfl', 'f1'].filter((l) => !myLeagues.includes(l));
    return [
      { value: 'top', label: 'Headlines' },
      ...(fav ? [{ value: 'mine', label: fav.short_name }] : []),
      ...[...myLeagues, ...extra].map((l) => ({ value: l, label: LEAGUE_BY_SLUG[l].shortName })),
    ];
  }, [myLeagues, fav]);
  const leagues = tab === 'top' ? myLeagues : tab === 'mine' ? fav?.leagues.slice(0, 1) ?? [] : [tab];
  const news = useApi<NewsFeed>('/news' + qs({ leagues, team: fav?.id, team_league: fav?.leagues[0], limit: 40 }), { maxAge: 300, poll: prefs.dataSaver ? 0 : 600 });
  const live = useApi<MatchCard[]>('/matches/live' + qs({ leagues: myLeagues.filter((l) => LEAGUE_BY_SLUG[l]?.format === 'match') }), { maxAge: 30, poll: prefs.dataSaver ? 0 : 45 });
  const items: Article[] = tab === 'mine' ? news.data?.my_team ?? [] : news.data?.items ?? [];
  const [hero, ...rest] = items;

  const header = (
    <View style={{ paddingTop: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text v="title">News</Text>
        <Icon name="newspaper-variant-multiple" size={26} color={t.brand} />
      </Row>
      <View style={{ marginTop: space.sm }}>
        <Segmented scroll options={tabs} value={tab} onChange={setTab} />
      </View>
      {live.data?.length ? (
        <>
          <SectionHeader title="Live now" icon="access-point" color={t.live} />
          <MatchStrip items={live.data} />
        </>
      ) : null}
      <StatusBanner error={news.error} offline={news.offline} updatedAt={news.updatedAt} onRetry={news.refresh} />
      <SectionHeader title={tab === 'mine' ? `${fav?.name ?? 'Team'} news` : 'Trending · latest headlines'} icon="fire" color={t.pending} />
      {hero ? <ArticleRow a={hero} big /> : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Backdrop />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <FlatList
          data={rest}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => <ArticleRow a={item} />}
          ListHeaderComponent={header}
          ListEmptyComponent={
            news.loading ? (
              <ActivityIndicator color={t.brand} style={{ marginTop: space.xl }} />
            ) : hero ? undefined : (
              <EmptyState icon="newspaper-variant-outline" title="No headlines" body={news.error ?? 'Nothing published for this selection right now.'} action={news.error ? 'Try again' : undefined} onAction={news.refresh} />
            )
          }
          ListFooterComponent={
            items.length ? (
              <Text v="tiny" muted style={{ marginTop: space.md }}>
                Headlines from ESPN. Articles open in your browser.
              </Text>
            ) : undefined
          }
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: TAB_BAR_SPACE + space.lg }}
          refreshControl={<RefreshControl refreshing={news.refreshing} onRefresh={news.refresh} tintColor={t.brand} />}
          initialNumToRender={8}
          windowSize={7}
        />
      </SafeAreaView>
    </View>
  );
}

export { ErrorBoundary } from '@/components/route-error';
