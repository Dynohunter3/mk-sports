/** Season recap: best pick, longest streak, the team you called best, and your season against the AI. */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api/cache';
import type { GameSummary } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { RecapCard } from '@/components/cards';
import { Backdrop, Glass } from '@/components/glass';
import { TeamBadge } from '@/components/match';
import { ShareSheet } from '@/components/sharecard';
import { Button, EmptyState, Icon, Loading, Row, StatTile, Text } from '@/components/ui';
import { outcomeLabel } from '@/lib/format';
import { space, useTheme } from '@/theme/theme';

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function RecapScreen() {
  const t = useTheme();
  const { me } = useAuth();
  const g = useApi<GameSummary>('/me/game', { maxAge: 10 });
  const [share, setShare] = useState(false);
  if (g.loading && !g.data) return <Loading />;
  const r = g.data?.recap;
  const name = g.data?.display_name && g.data.display_name !== 'You' ? g.data.display_name : me?.display_name ?? 'Me';
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Backdrop />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <Row style={{ paddingHorizontal: space.lg, paddingTop: space.sm, minHeight: 48 }}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/leaderboard'))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
            <Icon name="chevron-left" size={28} color={t.text} />
          </Pressable>
          <Text v="title">Season recap</Text>
        </Row>
        {!r || !r.picks ? (
          <EmptyState icon="movie-open-star-outline" title="Nothing to recap yet" body="Your recap fills in as your picks settle this season." />
        ) : (
          <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}>
            <Text v="label" dim>
              {r.season} · {r.picks} picks settled
            </Text>
            <Row style={{ marginTop: space.sm }}>
              <StatTile label="Points" value={String(r.points)} color={t.brand} />
              <StatTile label="Right" value={r.accuracy === null ? '–' : pct(r.accuracy)} sub={`${r.correct}/${r.picks}`} />
              <StatTile label="Best streak" value={`${r.longest_streak}🔥`} color={t.gold} />
            </Row>
            <Glass style={{ marginTop: space.md }}>
              <Text v="label" color={t.violet}>
                Best pick
              </Text>
              {r.best_pick ? (
                <>
                  <Text v="h3" style={{ marginTop: 4 }}>
                    {outcomeLabel(r.best_pick.pick, r.best_pick.home, r.best_pick.away)}
                    {r.best_pick.final_score ? ` · ${r.best_pick.final_score[0]}-${r.best_pick.final_score[1]}` : ''}
                  </Text>
                  <Text v="small" dim>
                    {r.best_pick.match} ·{' '}
                    {r.best_pick.ai_chance !== null
                      ? `the AI gave that result ${pct(r.best_pick.ai_chance)}, and you called it`
                      : r.best_pick.against_ai
                        ? 'you went against the AI and were right'
                        : `${r.best_pick.points} points`}
                  </Text>
                </>
              ) : (
                <Text v="small" dim>
                  Your first correct pick will show here.
                </Text>
              )}
            </Glass>
            <Glass style={{ marginTop: space.md }}>
              <Text v="label" color={t.brand}>
                The team you call best
              </Text>
              {r.best_team ? (
                <Row style={{ marginTop: 6 }}>
                  <TeamBadge team={{ id: r.best_team.name, name: r.best_team.name, short_name: r.best_team.name, code: r.best_team.code, color: r.best_team.color, logo: r.best_team.logo }} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text v="h3">{r.best_team.name}</Text>
                    <Text v="small" dim>
                      {r.best_team.correct} right from {r.best_team.picks} picks on their matches
                    </Text>
                  </View>
                </Row>
              ) : (
                <Text v="small" dim>
                  Shows once you have three or more picks on a team&apos;s matches.
                </Text>
              )}
            </Glass>
            <Glass style={{ marginTop: space.md }}>
              <Text v="label" color={t.hot}>
                You vs the AI this season
              </Text>
              <Text v="h3" style={{ marginTop: 4 }}>
                {r.vs_ai.matches ? `You ${r.vs_ai.you} – ${r.vs_ai.ai} AI` : 'No matches with an AI call yet'}
              </Text>
              {r.vs_ai.matches ? (
                <Text v="small" dim>
                  Right results on the {r.vs_ai.matches} matches you both called.
                </Text>
              ) : null}
              {r.probability.matches && r.probability.you !== null && r.probability.ai !== null ? (
                <Text v="small" dim style={{ marginTop: 4 }}>
                  Probability picks: your Brier score {r.probability.you.toFixed(3)} against the AI&apos;s {r.probability.ai.toFixed(3)} over {r.probability.matches} matches (lower is better).
                </Text>
              ) : null}
            </Glass>
            <Row style={{ marginTop: space.md }}>
              <StatTile label="Exact scores" value={String(r.exact)} color={t.accent2} />
              <StatTile label="Bankers won" value={`${r.bankers.won}/${r.bankers.played}`} color={t.gold} />
              <StatTile label="F1 + tennis" value={String(r.other_sports.points)} sub={`${r.other_sports.picks} picks`} />
            </Row>
            <Button title="Share my recap" icon="share-variant" onPress={() => setShare(true)} style={{ marginTop: space.xl }} />
          </ScrollView>
        )}
      </SafeAreaView>
      {r ? (
        <ShareSheet visible={share} onClose={() => setShare(false)} title="My MK Sports season">
          <RecapCard name={name} avatar={me?.avatar ?? '⚽'} r={r} />
        </ShareSheet>
      ) : null}
    </View>
  );
}

export { ErrorBoundary } from '@/components/route-error';
