import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ReactElement, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';

import { useApi } from '@/api/cache';
import { qs } from '@/api/client';
import type { Team, TeamHub } from '@/api/types';
import { LEAGUE_BY_SLUG, MATCH_LEAGUES } from '@/data/leagues';
import { FavouriteTeam, usePrefs } from '@/state/prefs';
import { alpha, mix, radius, space, SPORT_ICONS, TAB_BAR_SPACE, TAP, useTheme } from '@/theme/theme';

import { Crest, PlayerPhoto } from './crest';
import { matchTeam, useEloHistory } from '@/data/published';

import { EloHistoryCard } from './elochart';
import { TeamForecastCard } from './forecast';
import { ArticleRow } from './feed';
import { Glass } from './glass';
import { FormPills, MatchRow, StandingsTable, TeamBadge } from './match';
import { LeadersView } from './sportviews';
import { Button, Chip, ChipRow, EmptyState, Icon, Row, SectionHeader, Segmented, StatusBanner, Text } from './ui';

export function toFavourite(t: { id: string; name: string; short_name: string; code: string; color: string; logo?: string | null }, sport: string, leagues: string[]): FavouriteTeam {
  return { id: t.id, name: t.name, short_name: t.short_name, code: t.code, color: t.color, logo: t.logo ?? null, sport, leagues };
}

type HubTab = 'overview' | 'fixtures' | 'squad' | 'news';

export function TeamHubView({ id, leagues, onBack, tab = false }: { id: string; leagues?: string[]; onBack?: () => void; tab?: boolean }) {
  const t = useTheme();
  const { prefs, update } = usePrefs();
  const hub = useApi<TeamHub>(`/teams/${encodeURIComponent(id)}${qs({ leagues })}`, { maxAge: 120, poll: prefs.dataSaver ? 0 : 120 });
  const [section, setSection] = useState<HubTab>('overview');
  const isFav = prefs.favoriteTeam?.id === id;
  const h = hub.data;
  // the published model's rating, when the team's league has one, so the header and the strength chart agree
  const eloDoc = useEloHistory(h?.sport === 'football' ? h.league.id : null);
  const modelRating = h && eloDoc ? matchTeam(eloDoc.teams, [h.team.name, h.team.short_name])?.rating ?? null : null;
  // keep the favourite's competitions complete (e.g. a club that is also in Europe)
  const hubLeagues = h?.leagues.map((l) => l.id).join(',') ?? '';
  useEffect(() => {
    const fav = prefs.favoriteTeam;
    if (!h || !fav || fav.id !== id) return;
    const ids = h.leagues.map((l) => l.id);
    if (ids.join(',') !== fav.leagues.join(',') || (h.team.logo && h.team.logo !== fav.logo)) {
      update({ favoriteTeam: { ...fav, leagues: ids, logo: h.team.logo ?? fav.logo }, leagues: [...new Set([...prefs.leagues, ...ids])] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubLeagues, id]);
  if (hub.loading) return <ActivityIndicator color={t.brand} style={{ marginTop: 120 }} />;
  if (!h) return <EmptyState icon="shield-off-outline" title="Team not available" body={hub.error ?? undefined} action="Try again" onAction={hub.refresh} />;
  const color = h.team.color;
  const top = mix(color, '#000000', 0.15);
  const next = h.upcoming[0];
  const setFav = () => {
    update({ favoriteTeam: toFavourite(h.team, h.sport, h.leagues.map((l) => l.id)), leagues: [...new Set([...prefs.leagues, ...h.leagues.map((l) => l.id)])] });
  };

  const header = (
    <View>
      <LinearGradient colors={[top, alpha(color, 0.35), alpha(color, 0)]} style={{ paddingTop: space.md, paddingHorizontal: space.lg, paddingBottom: space.lg }}>
        <Row style={{ justifyContent: 'space-between', minHeight: 40 }}>
          {onBack ? (
            <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chevron-left" size={26} color="#fff" />
            </Pressable>
          ) : (
            <View />
          )}
          {isFav ? (
            <Chip label={tab ? 'Change team' : 'My team'} icon={tab ? 'swap-horizontal' : 'star'} onPress={tab ? () => update({ favoriteTeam: null }) : undefined} selected />
          ) : (
            <Chip label="Set as my team" icon="star-outline" onPress={setFav} />
          )}
        </Row>
        <View style={{ alignItems: 'center', marginTop: space.sm }}>
          <Crest team={h.team} size={96} />
          <Text v="title" color="#FFFFFF" style={{ marginTop: space.md, textAlign: 'center' }}>
            {h.team.name}
          </Text>
          <Text v="small" color="rgba(255,255,255,0.85)" style={{ marginTop: 2 }}>
            {h.league.name}
            {h.standing ? ` · ${h.standing.position}${['st', 'nd', 'rd'][h.standing.position - 1] ?? 'th'}` : ''}
            {modelRating ? ` · Rating ${modelRating}` : h.elo ? ` · Elo ${h.elo}` : ''}
          </Text>
          {h.form ? (
            <View style={{ marginTop: space.sm }}>
              <FormPills results={h.form} />
            </View>
          ) : null}
        </View>
      </LinearGradient>
      <View style={{ paddingHorizontal: space.lg }}>
        <Segmented
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'fixtures', label: 'Matches' },
            { value: 'squad', label: 'Squad' },
            { value: 'news', label: 'News' },
          ]}
          value={section}
          onChange={setSection}
        />
        <StatusBanner error={hub.error} offline={hub.offline} updatedAt={hub.updatedAt} onRetry={hub.refresh} />
      </View>
    </View>
  );

  const pad = { paddingHorizontal: space.lg };
  let content: ReactElement;
  if (section === 'overview') {
    content = (
      <View style={pad}>
        {next ? (
          <>
            <SectionHeader title={next.status === 'live' ? 'Live now' : 'Next match'} icon={next.status === 'live' ? 'access-point' : 'calendar-arrow-right'} color={next.status === 'live' ? t.live : undefined} />
            <MatchRow m={next} />
          </>
        ) : null}
        {h.recent[0] ? (
          <>
            <SectionHeader title="Last result" icon="flag-checkered" />
            <MatchRow m={h.recent[0]} />
          </>
        ) : null}
        {h.table.length ? (
          <>
            <SectionHeader title={`${h.league.short_name} table`} icon="table-large" action="Full table" onAction={() => router.push(`/league/${h.league.id}`)} />
            <Glass>
              <StandingsTable rows={h.table} sport={h.sport} highlight={[h.team.id]} compact onTeam={(tm) => tm.id !== h.team.id && router.push({ pathname: '/team/[id]', params: { id: tm.id } })} />
            </Glass>
          </>
        ) : null}
        {h.sport === 'football' ? (
          <>
            <TeamForecastCard league={h.league.id} names={[h.team.name, h.team.short_name]} color={h.team.color} />
            <EloHistoryCard league={h.league.id} names={[h.team.name, h.team.short_name]} color={h.team.color} leagueName={h.league.short_name} />
          </>
        ) : null}
        {h.leaders.length ? (
          <>
            <SectionHeader title="Top players this season" icon="account-star" />
            <LeadersView categories={h.leaders.slice(0, 4)} league={h.league.id} />
          </>
        ) : null}
        {h.news.length ? (
          <>
            <SectionHeader title="Latest news" icon="newspaper-variant-outline" action="More" onAction={() => setSection('news')} />
            <Glass padded={false} style={{ paddingHorizontal: space.md }}>
              {h.news.slice(0, 3).map((a) => (
                <ArticleRow key={a.id} a={a} />
              ))}
            </Glass>
          </>
        ) : null}
      </View>
    );
  } else if (section === 'fixtures') {
    content = (
      <View style={pad}>
        <SectionHeader title="Coming up" icon="calendar-arrow-right" />
        {h.upcoming.length ? h.upcoming.map((m) => <MatchRow key={m.id} m={m} />) : <Text dim>No fixtures in the next six weeks.</Text>}
        <SectionHeader title="Recent results" icon="flag-checkered" />
        {h.recent.length ? h.recent.map((m) => <MatchRow key={m.id} m={m} />) : <Text dim>No recent results.</Text>}
      </View>
    );
  } else if (section === 'squad') {
    const groups = new Map<string, typeof h.squad>();
    for (const p of h.squad) groups.set(p.position ?? 'Other', [...(groups.get(p.position ?? 'Other') ?? []), p]);
    content = (
      <View style={pad}>
        {!h.squad.length ? <EmptyState icon="account-group-outline" title="No squad list" body="The data source doesn't publish a squad for this team." /> : null}
        {[...groups.entries()].map(([pos, list]) => (
          <View key={pos}>
            <SectionHeader title={pos} />
            <Glass padded={false}>
              {list.map((p, i) => (
                <Pressable key={p.id} onPress={() => router.push({ pathname: '/player/[id]', params: { id: p.id, league: h.league.id } })} accessibilityRole="button" style={{ borderTopWidth: i ? 1 : 0, borderColor: t.glassBorder }}>
                  <Row gap={10} style={{ paddingHorizontal: space.lg, paddingVertical: 10 }}>
                    <PlayerPhoto url={p.headshot} jersey={p.jersey} color={h.team.color} size={36} who={h.sport === 'football' ? { id: p.id, name: p.name, dob: p.dob, team: h.team.id, league: h.league.id } : null} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700' }}>{p.name}</Text>
                      <Text v="tiny" muted>
                        {[p.jersey ? `#${p.jersey}` : null, p.age ? `${p.age} yrs` : null, p.nationality].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={18} />
                  </Row>
                </Pressable>
              ))}
            </Glass>
          </View>
        ))}
      </View>
    );
  } else {
    content = (
      <View style={pad}>
        {h.news.length ? h.news.map((a) => <ArticleRow key={a.id} a={a} />) : <EmptyState icon="newspaper-variant-outline" title="No recent news" />}
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: (tab ? TAB_BAR_SPACE : 0) + space.xxl }} refreshControl={<RefreshControl refreshing={hub.refreshing} onRefresh={hub.refresh} tintColor="#fff" />}>
      {header}
      {content}
    </ScrollView>
  );
}

/** Search any team (all sports) or browse a competition's clubs. */
export function TeamPicker({ onPick, title = 'Choose your team' }: { onPick: (f: FavouriteTeam) => void; title?: string }) {
  const t = useTheme();
  const [search, setSearch] = useState('');
  const [league, setLeague] = useState('eng.1');
  const q = search.trim();
  const path = q.length >= 2 ? `/teams${qs({ search: q, limit: 30 })}` : `/teams${qs({ league_id: league, limit: 60 })}`;
  const teams = useApi<Team[]>(path, { maxAge: 86400, persist: q.length < 2 });
  const leagues = useMemo(() => MATCH_LEAGUES.filter((l) => l.kind === 'league' || l.slug === 'uefa.champions' || l.slug === 'caf.champions'), []);
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
        <Text v="title">{title}</Text>
        <Text dim style={{ marginTop: 2 }}>
          Their fixtures, results, news and stats come first everywhere in the app.
        </Text>
        <View style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center', backgroundColor: t.glass, borderColor: t.glassBorder, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md }}>
          <Icon name="magnify" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search teams (e.g. Arsenal, Lakers, Chiefs)"
            placeholderTextColor={t.textMuted}
            style={{ flex: 1, minHeight: TAP, color: t.text, paddingHorizontal: space.sm, fontSize: 15 }}
            accessibilityLabel="Search teams"
            autoCorrect={false}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={12} accessibilityLabel="Clear search">
              <Icon name="close-circle" />
            </Pressable>
          ) : null}
        </View>
        {q.length < 2 ? (
          <ChipRow>
            {leagues.map((l) => (
              <Chip key={l.slug} label={l.shortName} icon={SPORT_ICONS[l.sport]} selected={l.slug === league} color={l.theme.accent} onPress={() => setLeague(l.slug)} />
            ))}
          </ChipRow>
        ) : null}
      </View>
      <FlatList
        data={teams.data ?? []}
        keyExtractor={(x) => x.id}
        numColumns={3}
        columnWrapperStyle={{ gap: space.sm }}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: TAB_BAR_SPACE + space.lg }}
        ListEmptyComponent={teams.loading ? <ActivityIndicator color={t.brand} /> : <EmptyState icon="shield-search" title={teams.error ? "Can't load teams" : 'No teams found'} body={teams.error ?? undefined} />}
        renderItem={({ item }) => {
          const lgs = item.leagues?.length ? item.leagues : q.length < 2 ? [league] : [];
          return (
            <Glass onPress={() => onPick(toFavourite(item, item.sport, lgs))} accessibilityLabel={item.name} style={{ flex: 1, alignItems: 'center', minHeight: 116, justifyContent: 'center' }} padded={false}>
              <View style={{ padding: space.sm, alignItems: 'center' }}>
                <TeamBadge team={item} size={48} />
                <Text v="small" style={{ fontWeight: '700', textAlign: 'center', marginTop: 6 }} numberOfLines={2}>
                  {item.short_name}
                </Text>
                {q.length >= 2 && lgs[0] ? (
                  <Text v="tiny" muted numberOfLines={1}>
                    {LEAGUE_BY_SLUG[lgs[0]]?.shortName}
                  </Text>
                ) : null}
              </View>
            </Glass>
          );
        }}
      />
    </View>
  );
}

export function PickTeamButton({ onPress }: { onPress: () => void }) {
  return <Button title="Choose your team" icon="shield-plus-outline" onPress={onPress} />;
}
