import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api/cache';
import { qs } from '@/api/client';
import type { Feed, MatchCard, NewsFeed } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { Wordmark } from '@/components/brand';
import { Crest } from '@/components/crest';
import { ArticleRow, MatchStrip } from '@/components/feed';
import { Backdrop, Glass } from '@/components/glass';
import { MatchRow, StatusChip, TeamBadge } from '@/components/match';
import { Chip, ChipRow, Disclaimer, EmptyState, Icon, Loading, Row, SectionHeader, StatusBanner, Text } from '@/components/ui';
import { LEAGUE_BY_SLUG, MATCH_LEAGUES } from '@/data/leagues';
import { dayLabel, deviceTimeZone, kickoffTime, pct } from '@/lib/format';
import { FavouriteTeam, usePrefs } from '@/state/prefs';
import { alpha, LeagueTheme, space, TAB_BAR_SPACE, useTheme } from '@/theme/theme';

const SECTION_ICONS: Record<string, string> = {
  my_teams: 'star',
  today: 'calendar-today',
  top_predictions: 'robot-outline',
  upcoming: 'calendar-arrow-right',
  results: 'flag-checkered',
};

export default function HomeScreen() {
  const { prefs } = usePrefs();
  return (
    <LeagueTheme league={prefs.homeLeague}>
      <Home />
    </LeagueTheme>
  );
}

function LeagueChips() {
  const { prefs, update } = usePrefs();
  const list = useMemo(() => {
    const mine = [...new Set([...prefs.leagues, ...(prefs.favoriteTeam?.leagues ?? [])])].filter((l) => LEAGUE_BY_SLUG[l]?.format === 'match');
    const rest = MATCH_LEAGUES.filter((l) => !mine.includes(l.slug) && (l.featured || ['uefa.europa', 'uefa.europa.conf', 'ita.1', 'ger.1', 'fra.1', 'ned.1', 'por.1', 'tur.1', 'eng.2', 'nfl'].includes(l.slug))).map((l) => l.slug);
    return [...mine, ...rest];
  }, [prefs.leagues, prefs.favoriteTeam]);
  return (
    <ChipRow>
      <Chip label="All" icon="view-grid-outline" selected={!prefs.homeLeague} onPress={() => update({ homeLeague: null })} />
      {list.map((slug) => {
        const lg = LEAGUE_BY_SLUG[slug];
        return (
          <Chip
            key={slug}
            label={lg.shortName}
            color={lg.theme.accent}
            selected={prefs.homeLeague === slug}
            onPress={() => update({ homeLeague: prefs.homeLeague === slug ? null : slug })}
            left={<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: lg.theme.primary, borderWidth: 2, borderColor: lg.theme.accent }} />}
          />
        );
      })}
    </ChipRow>
  );
}

function MyTeamCard({ fav, items }: { fav: FavouriteTeam | null; items: MatchCard[] }) {
  const t = useTheme();
  if (!fav) {
    return (
      <Glass onPress={() => router.navigate('/team')} accessibilityLabel="Choose your team" style={{ marginTop: space.md }}>
        <Row gap={space.md}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: alpha(t.brand, 0.2), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield-plus-outline" size={26} color={t.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text v="h3">Choose your team</Text>
            <Text v="small" dim>
              Get their fixtures, results, news and stats first.
            </Text>
          </View>
          <Icon name="chevron-right" />
        </Row>
      </Glass>
    );
  }
  const live = items.find((m) => m.status === 'live');
  const next = items.find((m) => m.status === 'scheduled');
  const last = items.find((m) => m.status === 'finished');
  const line = (m: MatchCard, label: string) => {
    const home = m.home.id === fav.id;
    const opp = home ? m.away : m.home;
    const started = m.status !== 'scheduled';
    const us = home ? m.home_score : m.away_score;
    const them = home ? m.away_score : m.home_score;
    const res = m.status === 'finished' && us !== null && them !== null ? (us > them ? 'W' : us < them ? 'L' : 'D') : null;
    const p = m.prediction;
    return (
      <Pressable key={m.id} onPress={() => router.push(`/match/${m.id}`)} accessibilityRole="button" style={{ minHeight: 48, justifyContent: 'center' }}>
        <Row gap={10}>
          <Text v="tiny" muted style={{ width: 40, fontWeight: '800' }}>
            {label}
          </Text>
          <TeamBadge team={opp} size={22} />
          <View style={{ flex: 1 }}>
            <Text v="small" style={{ fontWeight: '700' }} numberOfLines={1}>
              {home ? 'vs' : '@'} {opp.short_name}
            </Text>
            <Text v="tiny" muted numberOfLines={1}>
              {m.league.short_name}
              {!started ? ` · ${dayLabel(new Date(m.start_time))} ${kickoffTime(m.start_time)}` : ''}
              {!started && p ? ` · AI: ${p.pick === 'draw' ? 'Draw' : (p.pick === 'home') === home ? fav.code : opp.code} ${pct(p.pick === 'home' ? p.home : p.pick === 'away' ? p.away : p.draw)}` : ''}
            </Text>
          </View>
          {started ? (
            <Row gap={6}>
              {m.status === 'live' ? <StatusChip m={m} /> : null}
              <Text v="mono">{`${us ?? 0}-${them ?? 0}`}</Text>
              {res ? (
                <View style={{ width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: res === 'W' ? t.win : res === 'L' ? t.loss : t.draw }}>
                  <Text v="tiny" color="#fff" style={{ fontWeight: '900' }}>
                    {res}
                  </Text>
                </View>
              ) : null}
            </Row>
          ) : (
            <Icon name="chevron-right" size={18} />
          )}
        </Row>
      </Pressable>
    );
  };
  return (
    <Glass tint={fav.color} style={{ marginTop: space.md }} padded={false}>
      <Pressable onPress={() => router.navigate('/team')} accessibilityRole="button" accessibilityLabel={`${fav.name} team hub`} style={{ padding: space.lg, paddingBottom: space.sm }}>
        <Row gap={space.md}>
          <Crest team={fav} size={56} />
          <View style={{ flex: 1 }}>
            <Text v="label" dim>
              My team
            </Text>
            <Text v="h2" numberOfLines={1}>
              {fav.name}
            </Text>
          </View>
          <Row gap={2}>
            <Text v="small" color={t.brand} style={{ fontWeight: '800' }}>
              Team hub
            </Text>
            <Icon name="chevron-right" color={t.brand} />
          </Row>
        </Row>
      </Pressable>
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
        {live ? line(live, 'LIVE') : null}
        {next ? line(next, 'NEXT') : null}
        {last ? line(last, 'LAST') : null}
        {!live && !next && !last ? (
          <Text v="small" dim style={{ paddingVertical: space.sm }}>
            No matches in the next few days. Open the team hub for the full schedule.
          </Text>
        ) : null}
      </View>
    </Glass>
  );
}

function Home() {
  const t = useTheme();
  const { prefs } = usePrefs();
  const { me } = useAuth();
  const [poll, setPoll] = useState(120);
  const fav = prefs.favoriteTeam;
  const league = prefs.homeLeague;
  const feedLeagues = league ? [league] : [...new Set([...prefs.leagues, ...(fav?.leagues ?? [])])];
  const path = '/feed' + qs({ sports: prefs.sports, leagues: feedLeagues, teams: prefs.teams, team: fav?.id, league, tz: deviceTimeZone() });
  const feed = useApi<Feed>(path, { maxAge: 30, poll: prefs.dataSaver ? 0 : poll });
  const newsLeagues = league ? [league] : feedLeagues.length ? feedLeagues : MATCH_LEAGUES.filter((l) => l.featured).map((l) => l.slug);
  const news = useApi<NewsFeed>('/news' + qs({ leagues: newsLeagues, team: fav?.id, team_league: fav?.leagues?.[0], limit: 5 }), { maxAge: 600 });
  const liveItems = feed.data?.sections.find((s) => s.key === 'live')?.items ?? [];
  const myTeamItems = feed.data?.sections.find((s) => s.key === 'my_team')?.items ?? [];
  useEffect(() => setPoll(liveItems.length ? 30 : 120), [liveItems.length]);

  const sections = useMemo(
    () => (feed.data?.sections ?? []).filter((s) => s.key !== 'live' && s.key !== 'my_team').map((s) => ({ key: s.key, title: s.title, data: s.items })),
    [feed.data],
  );
  const lg = league ? LEAGUE_BY_SLUG[league] : null;
  // upcoming matches where the model's call is in its strongest band
  const strongCalls = useMemo(() => {
    const seen = new Set<string>();
    return (feed.data?.sections ?? [])
      .flatMap((s) => s.items)
      .filter((m) => m.status === 'scheduled' && m.prediction?.tier === 'strong' && !seen.has(m.id) && !!seen.add(m.id))
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .slice(0, 10);
  }, [feed.data]);

  const header = (
    <View style={{ paddingTop: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable onPress={() => router.push('/profile')} accessibilityRole="button" accessibilityLabel="Profile" hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(t.text, 0.1), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="account" size={22} color={t.text} />
        </Pressable>
        <Wordmark size={30} />
        <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Settings" hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(t.text, 0.1), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cog-outline" size={22} color={t.text} />
        </Pressable>
      </Row>
      <Text v="small" dim style={{ textAlign: 'center', marginTop: 6 }}>
        {me ? `Hi ${me.display_name.split(' ')[0]} · ` : ''}
        {dayLabel(new Date())}, {new Date().toLocaleDateString([], { day: 'numeric', month: 'long' })}
      </Text>
      <View style={{ marginTop: space.md }}>
        <LeagueChips />
      </View>
      {lg ? (
        <Pressable onPress={() => router.push(`/league/${lg.slug}`)} accessibilityRole="link" style={{ minHeight: 40, justifyContent: 'center' }}>
          <Row gap={6}>
            <Icon name="table-large" size={18} color={t.brand} />
            <Text v="small" color={t.brand} style={{ fontWeight: '800' }}>
              {lg.name}: table, fixtures and player stats
            </Text>
          </Row>
        </Pressable>
      ) : null}
      {!league ? <MyTeamCard fav={fav} items={myTeamItems} /> : null}
      {me && feed.data?.open_picks ? (
        <View style={{ marginTop: space.md }}>
          <Chip label={`${feed.data.open_picks} open pick${feed.data.open_picks === 1 ? '' : 's'} · My points`} icon="hand-pointing-right" selected onPress={() => router.push('/leaderboard')} />
        </View>
      ) : null}
      <StatusBanner error={feed.error} offline={feed.offline} updatedAt={feed.updatedAt} onRetry={feed.refresh} />
      {feed.data?.predictions_loading ? (
        <Glass style={{ marginTop: space.md }}>
          <Row>
            <ActivityIndicator color={t.brand} />
            <Text v="small" dim style={{ flex: 1 }}>
              Building predictions from the last 12 months of real results. This one-time download takes a moment; scores and fixtures are already live.
            </Text>
          </Row>
        </Glass>
      ) : null}
      {liveItems.length ? (
        <>
          <SectionHeader title={prefs.dataSaver ? 'Live now' : 'Live now · auto-updating'} icon="access-point" color={t.live} />
          <MatchStrip items={liveItems} />
        </>
      ) : null}
      {strongCalls.length ? (
        <>
          <SectionHeader title="Strongest calls" icon="shield-check" color={t.win} action="Track record" onAction={() => router.push('/accuracy')} />
          <MatchStrip items={strongCalls} />
        </>
      ) : null}
      {news.data?.items.length ? (
        <>
          <SectionHeader title="Trending" icon="fire" color={t.pending} action="All news" onAction={() => router.navigate('/news')} />
          <Glass padded={false} style={{ paddingHorizontal: space.md }}>
            {news.data.items.slice(0, 3).map((a) => (
              <ArticleRow key={a.id} a={a} />
            ))}
          </Glass>
        </>
      ) : null}
      {feed.data?.unavailable?.length ? (
        <Text v="tiny" muted style={{ marginTop: space.sm }}>
          Temporarily unavailable from the data source: {feed.data.unavailable.join(', ')}
        </Text>
      ) : null}
    </View>
  );

  if (feed.loading) return <Loading label="Loading today's matches…" />;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Backdrop />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <SectionList<MatchCard, { key: string; title: string; data: MatchCard[] }>
          sections={sections}
          keyExtractor={(m) => String(m.id)}
          renderItem={({ item }) => <MatchRow m={item} showLeague={!league} />}
          renderSectionHeader={({ section }) => <SectionHeader title={section.title} icon={SECTION_ICONS[section.key]} />}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={header}
          ListEmptyComponent={
            feed.error && !feed.data ? (
              <EmptyState icon="wifi-off" title="Can't reach the live data" body={feed.error} action="Try again" onAction={feed.refresh} />
            ) : liveItems.length ? undefined : (
              <EmptyState title="No matches right now" body="Check Scores for other days and sports." action="Open Scores" onAction={() => router.navigate('/sports')} />
            )
          }
          ListFooterComponent={<Disclaimer />}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: TAB_BAR_SPACE + space.lg }}
          refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={feed.refresh} tintColor={t.brand} />}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
        />
      </SafeAreaView>
    </View>
  );
}
