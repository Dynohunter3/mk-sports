/** Search teams, players and competitions. */
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Crest } from '@/components/crest';
import { PressableScale } from '@/components/motion';
import { fieldStyle } from '@/components/profile';
import { EmptyState, Icon, Row, SectionHeader, Text } from '@/components/ui';
import type { LeagueDef } from '@/data/leagues';
import { searchAll, searchCompetitions, type PlayerHit, type TeamHit } from '@/data/search';
import { alpha, radius, space, TAP, useTheme } from '@/theme/theme';

export default function SearchScreen() {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ competitions: LeagueDef[]; teams: TeamHit[]; players: PlayerHit[]; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setRes(null);
      return;
    }
    setRes((r) => ({ competitions: searchCompetitions(query), teams: r?.teams ?? [], players: r?.players ?? [], error: false }));
    if (query.length < 2) return;
    const my = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      searchAll(query)
        .then((r) => my === seq.current && setRes(r))
        .finally(() => my === seq.current && setBusy(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const row = (key: string, onPress: () => void, left: React.ReactNode, title: string, sub: string, label: string) => (
    <PressableScale key={key} onPress={onPress} accessibilityLabel={label} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassBorder, marginBottom: 6 }}>
      {left}
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '800' }} numberOfLines={1}>
          {title}
        </Text>
        <Text v="tiny" muted numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Icon name="chevron-right" color={t.textMuted} />
    </PressableScale>
  );
  const empty = res && !busy && !res.competitions.length && !res.teams.length && !res.players.length;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <Row gap={space.sm} style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md }}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} style={{ width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="arrow-left" size={24} color={t.text} />
          </Pressable>
          <TextInput
            value={q}
            onChangeText={setQ}
            autoFocus
            placeholder="Teams, players, competitions"
            placeholderTextColor={t.textMuted}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search teams, players and competitions"
            style={fieldStyle(t)}
          />
        </Row>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          {!res ? (
            <EmptyState icon="magnify" title="Search MK Sports" body="Find a team, a player or a competition." />
          ) : (
            <>
              {res.competitions.length ? (
                <>
                  <SectionHeader title="Competitions" icon="trophy-outline" />
                  {res.competitions.map((l) =>
                    row(
                      l.slug,
                      () => router.push(`/league/${l.slug}`),
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: l.theme.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: alpha(l.theme.accent, 0.8) }}>
                        <Icon name="trophy" size={18} color={l.theme.accent} />
                      </View>,
                      l.name,
                      [l.country ?? l.region, l.kind === 'league' ? 'League' : l.kind === 'cup' ? 'Cup' : 'Tournament'].join(' · '),
                      `${l.name} competition`,
                    ),
                  )}
                </>
              ) : null}
              {res.teams.length ? (
                <>
                  <SectionHeader title="Teams" icon="shield-outline" />
                  {res.teams.map((tm) =>
                    row(
                      tm.id + tm.league,
                      () => router.push({ pathname: '/team/[id]', params: { id: tm.id, league: tm.league } }),
                      <Crest team={{ code: tm.abbr || tm.name.slice(0, 3).toUpperCase(), color: tm.color, logo: tm.logo, name: tm.name }} size={36} />,
                      tm.name,
                      tm.leagueName,
                      `${tm.name}, ${tm.leagueName}`,
                    ),
                  )}
                </>
              ) : null}
              {res.players.length ? (
                <>
                  <SectionHeader title="Players" icon="account-outline" />
                  {res.players.map((p) =>
                    row(
                      p.id,
                      () => router.push({ pathname: '/player/[id]', params: { id: p.id, league: p.league } }),
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: alpha(t.text, 0.08), alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="account" size={20} color={t.textDim} />
                      </View>,
                      p.name,
                      p.leagueName,
                      `${p.name}, ${p.leagueName}`,
                    ),
                  )}
                </>
              ) : null}
              {busy ? (
                <Text v="small" dim style={{ textAlign: 'center', marginTop: space.lg }}>
                  Searching…
                </Text>
              ) : null}
              {empty ? <EmptyState icon="magnify-close" title="Nothing found" body={res.error ? "You're offline or the search is unavailable. Competitions can still be found." : 'Try another spelling, or fewer words.'} /> : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export { ErrorBoundary } from '@/components/route-error';
