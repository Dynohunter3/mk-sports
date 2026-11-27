import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api/cache';
import { qs } from '@/api/client';
import { usePaged } from '@/api/paged';
import type { CricketMatch, F1Board, League, MatchCard, Sport, Team, TennisBoard } from '@/api/types';
import { Backdrop } from '@/components/glass';
import { MatchRow } from '@/components/match';
import { CricketView, F1View, TennisView } from '@/components/sportviews';
import { Chip, ChipRow, EmptyState, Icon, Loading, Row, SectionHeader, StatusBanner, Text } from '@/components/ui';
import { addDays, dateKey, dayLabel, deviceTimeZone } from '@/lib/format';
import { usePrefs } from '@/state/prefs';
import { LeagueTheme, radius, space, SPORT_ICONS, TAB_BAR_SPACE, TAP, useTheme } from '@/theme/theme';

const DAYS = [-2, -1, 0, 1, 2, 3, 4, 5, 6];

export default function SportsScreen() {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  return (
    <LeagueTheme league={leagueId}>
      <Scores leagueId={leagueId} setLeagueId={setLeagueId} />
    </LeagueTheme>
  );
}

/** Tennis, Formula 1 and cricket have their own boards instead of team fixtures. */
function OtherSport({ slug }: { slug: string }) {
  const t = useTheme();
  const { prefs } = usePrefs();
  const [tour, setTour] = useState<'atp' | 'wta'>('atp');
  const poll = prefs.dataSaver ? 0 : 60;
  const tennis = useApi<TennisBoard>(slug === 'tennis' ? `/tennis/${tour}` : null, { maxAge: 60, poll });
  const f1 = useApi<F1Board>(slug === 'formula1' ? '/f1' : null, { maxAge: 120, poll });
  const cricket = useApi<CricketMatch[]>(slug === 'cricket' ? '/cricket' : null, { maxAge: 60, poll });
  const cur = slug === 'tennis' ? tennis : slug === 'formula1' ? f1 : cricket;
  return (
    <View style={{ marginTop: space.md }}>
      {slug === 'tennis' ? (
        <ChipRow>
          <Chip label="ATP" selected={tour === 'atp'} onPress={() => setTour('atp')} />
          <Chip label="WTA" selected={tour === 'wta'} onPress={() => setTour('wta')} />
        </ChipRow>
      ) : null}
      <StatusBanner error={cur.error} offline={cur.offline} updatedAt={cur.updatedAt} onRetry={cur.refresh} />
      {cur.loading ? <ActivityIndicator color={t.brand} style={{ marginTop: space.xl }} /> : null}
      {slug === 'tennis' && tennis.data ? <TennisView board={tennis.data} tour={tour} /> : null}
      {slug === 'formula1' && f1.data ? <F1View board={f1.data} /> : null}
      {slug === 'cricket' && cricket.data ? <CricketView matches={cricket.data} /> : null}
    </View>
  );
}

function Scores({ leagueId, setLeagueId }: { leagueId: string | null; setLeagueId: (l: string | null) => void }) {
  const t = useTheme();
  const { prefs } = usePrefs();
  const sports = useApi<Sport[]>('/sports?include_inactive=true', { maxAge: 3600 });
  const active = (sports.data ?? []).filter((s) => s.is_active);
  const soon = (sports.data ?? []).filter((s) => !s.is_active);
  const [sportSlug, setSportSlug] = useState<string | null>(null);
  // other screens can open a sport directly (e.g. My game > Tennis)
  const { sport: wanted } = useLocalSearchParams<{ sport?: string }>();
  useEffect(() => {
    if (wanted) setSportSlug(wanted);
  }, [wanted]);
  const sport = active.find((s) => s.slug === sportSlug) ?? active.find((s) => prefs.sports.includes(s.id)) ?? active[0];
  const [offset, setOffset] = useState(0);
  const [team, setTeam] = useState<Team | null>(null);
  const isOther = sport?.slug === 'tennis' || sport?.slug === 'formula1' || sport?.slug === 'cricket';
  const [search, setSearch] = useState('');

  const leagues = useApi<League[]>(sport && !isOther ? `/leagues?sport=${sport.slug}&format=match` : null, { maxAge: 3600 });
  const teamResults = useApi<Team[]>(search.trim().length >= 2 && sport && !isOther ? `/teams${qs({ search: search.trim(), sport: sport.slug, limit: 8 })}` : null, { persist: false });
  const day = dateKey(addDays(new Date(), offset));
  // stable per day, so the cache key doesn't change on every render
  const teamFrom = useMemo(() => {
    const d = addDays(new Date(), -3);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the selected day changes (e.g. after midnight)
  }, [day]);
  const path = sport && !isOther
    ? '/matches' + qs(team ? { team_id: team.id, from: teamFrom, limit: 30 } : { date: day, tz: deviceTimeZone(), sport: sport.slug, league_id: leagueId, limit: 40 })
    : null;
  const matches = usePaged<MatchCard>(path, { maxAge: 60, poll: prefs.dataSaver ? 0 : 60 });

  const leagueList = useMemo(() => (leagues.data ?? []).slice().sort((a, b) => Number(prefs.leagues.includes(b.id)) - Number(prefs.leagues.includes(a.id))), [leagues.data, prefs.leagues]);

  if (sports.loading) return <Loading />;
  const header = (
    <View style={{ paddingTop: space.md }}>
      <Text v="title">Scores</Text>
      <ChipRow>
        {active.map((s) => (
          <Chip
            key={s.slug}
            label={s.name}
            icon={SPORT_ICONS[s.slug]}
            color={s.color}
            selected={sport?.slug === s.slug}
            onPress={() => {
              setSportSlug(s.slug);
              setLeagueId(null);
              setTeam(null);
            }}
          />
        ))}
        {soon.slice(0, 4).map((s) => (
          <Chip key={s.slug} label={s.name} icon={SPORT_ICONS[s.slug]} disabled badge={s.tier === 1 ? 'soon' : 'later'} />
        ))}
      </ChipRow>
      {isOther ? <OtherSport slug={sport!.slug} /> : null}
      {!isOther ? (
      <>
      <SectionHeader title="Competitions" />
      <ChipRow>
        <Chip label="All" selected={leagueId === null} onPress={() => setLeagueId(null)} color={sport?.color} />
        {leagueList.map((lg) => (
          <Chip key={lg.id} label={lg.short_name} selected={leagueId === lg.id} onPress={() => setLeagueId(lg.id === leagueId ? null : lg.id)} color={sport?.color} />
        ))}
      </ChipRow>
      {leagueId ? (
        <Pressable onPress={() => router.push(`/league/${leagueId}`)} style={{ minHeight: TAP, justifyContent: 'center' }} accessibilityRole="link">
          <Row>
            <Icon name="table-large" color={t.brand} />
            <Text color={t.brand} style={{ fontWeight: '700' }}>
              Open {leagueList.find((l) => l.id === leagueId)?.name}: table, results & player stats
            </Text>
          </Row>
        </Pressable>
      ) : null}

      <View style={{ marginTop: space.md, flexDirection: 'row', alignItems: 'center', backgroundColor: t.glass, borderColor: t.glassBorder, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md }}>
        <Icon name="magnify" />
        <TextInput
          value={team ? team.name : search}
          onChangeText={(v) => {
            setTeam(null);
            setSearch(v);
          }}
          placeholder={`Filter by team (e.g. ${({ basketball: 'Lakers', 'american-football': 'Chiefs', 'ice-hockey': 'Maple Leafs', baseball: 'Yankees' } as Record<string, string>)[sport?.slug ?? ''] ?? 'Arsenal'})`}
          placeholderTextColor={t.textMuted}
          style={{ flex: 1, minHeight: TAP, color: t.text, paddingHorizontal: space.sm, fontSize: 15 }}
          accessibilityLabel="Filter by team"
        />
        {team || search ? (
          <Pressable onPress={() => { setTeam(null); setSearch(''); }} hitSlop={12} accessibilityLabel="Clear team filter">
            <Icon name="close-circle" />
          </Pressable>
        ) : null}
      </View>
      {!team && teamResults.data?.length ? (
        <View style={{ backgroundColor: t.glassStrong, borderRadius: radius.md, marginTop: 4, borderWidth: 1, borderColor: t.glassBorder }}>
          {teamResults.data.map((tm) => (
            <Pressable key={tm.id} onPress={() => { setTeam(tm); setSearch(''); }} style={{ minHeight: TAP, justifyContent: 'center', paddingHorizontal: space.md }}>
              <Text>{tm.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {!team ? (
        <ChipRow>
          {DAYS.map((d) => (
            <Chip key={d} label={dayLabel(addDays(new Date(), d))} selected={offset === d} onPress={() => setOffset(d)} color={sport?.color} />
          ))}
        </ChipRow>
      ) : (
        <Text v="small" dim style={{ marginTop: space.sm }}>
          Recent and upcoming matches for {team.name}
        </Text>
      )}
      <StatusBanner error={matches.error} offline={matches.offline} updatedAt={matches.updatedAt} onRetry={matches.refresh} />
      <View style={{ height: space.sm }} />
      </>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
    <Backdrop />
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <FlatList
        data={isOther ? [] : matches.items}
        keyExtractor={(m) => String(m.id)}
        renderItem={({ item }) => <MatchRow m={item} showLeague={!leagueId} />}
        ListHeaderComponent={header}
        ListEmptyComponent={isOther ? undefined : matches.loading ? <ActivityIndicator color={t.brand} style={{ marginTop: space.xl }} /> : <EmptyState title="No matches" body={team ? 'No recent or upcoming matches found.' : `Nothing scheduled ${dayLabel(addDays(new Date(), offset)).toLowerCase()} for this selection.`} />}
        ListFooterComponent={matches.loadingMore ? <ActivityIndicator color={t.brand} style={{ margin: space.lg }} /> : undefined}
        onEndReached={matches.loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: TAB_BAR_SPACE + space.lg }}
        initialNumToRender={8}
        windowSize={7}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
    </View>
  );
}

export { ErrorBoundary } from '@/components/route-error';
