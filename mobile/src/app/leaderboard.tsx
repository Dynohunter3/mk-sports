import { router } from 'expo-router';
import { memo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api/cache';
import { DATA_MODE } from '@/api/client';
import type { Leaderboard, LeaderboardRow, LocalPoints, Me } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { Button, Card, Chip, ChipRow, Disclaimer, EmptyState, Icon, Loading, Row, Segmented, StatTile, StatusBanner, Text } from '@/components/ui';
import { flag, initials } from '@/lib/format';
import { radius, space, TAP, useTheme } from '@/theme/theme';

type Period = 'week' | 'season' | 'all';
const PERIODS: { value: Period; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'season', label: 'Season' },
  { value: 'all', label: 'All-time' },
];

const RankRow = memo(function RankRow({ r }: { r: LeaderboardRow }) {
  const t = useTheme();
  const medal = r.rank === 1 ? '#FACC15' : r.rank === 2 ? '#CBD5E1' : r.rank === 3 ? '#D97706' : null;
  return (
    <Row
      style={{ minHeight: TAP + 8, paddingHorizontal: space.md, borderRadius: radius.md, marginBottom: 6, backgroundColor: r.is_me ? t.brand + '26' : t.surface, borderWidth: r.is_me ? 1 : 0, borderColor: t.brand }}
      gap={space.md}
    >
      <Text v="mono" color={medal ?? t.textDim} style={{ width: 34, textAlign: 'right' }}>
        {r.rank}
      </Text>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Text v="small" style={{ fontWeight: '800' }}>
          {initials(r.display_name)}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: r.is_me ? '800' : '600' }} numberOfLines={1}>
          {r.display_name} {flag(r.country)}
        </Text>
        <Text v="tiny" muted>
          {r.correct}/{r.picks} correct · {r.exact} exact
        </Text>
      </View>
      <Text v="h3">{r.points}</Text>
      <Text v="tiny" muted>
        pts
      </Text>
    </Row>
  );
});

function GlobalLeaderboard() {
  const t = useTheme();
  const { signedIn } = useAuth();
  const [period, setPeriod] = useState<Period>('week');
  const lb = useApi<Leaderboard>(`/leaderboards/global?period=${period}&limit=100`, { maxAge: 60 });
  const meVisible = lb.data?.items.some((r) => r.is_me);

  const header = (
    <View style={{ paddingTop: space.md, gap: space.md }}>
      <Text v="title">Leaderboard</Text>
      <ChipRow>
        <Chip label="Global" icon="earth" selected />
        <Chip label="Friends" icon="account-multiple" disabled badge="soon" />
        <Chip label="Private leagues" icon="shield-account" onPress={() => router.push('/private-leagues')} />
      </ChipRow>
      <Segmented options={PERIODS} value={period} onChange={setPeriod} />
      {lb.data ? (
        <Text v="small" muted>
          {lb.data.period === 'week' ? `Week ${lb.data.period_key.split('-W')[1]}` : lb.data.period === 'season' ? `Season ${lb.data.period_key}` : 'All-time'} · {lb.data.total} players · 3 pts per correct result, bonus for exact scores
        </Text>
      ) : null}
      <StatusBanner error={lb.error} offline={lb.offline} updatedAt={lb.updatedAt} onRetry={lb.refresh} />
      {!signedIn ? (
        <Button title="Sign in to compete" kind="secondary" icon="login" onPress={() => router.push('/sign-in')} />
      ) : null}
    </View>
  );

  if (lb.loading) return <Loading />;
  return (
    <SafeAreaView edges={[]} style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={lb.data?.items ?? []}
        keyExtractor={(r) => r.user_id}
        renderItem={({ item }) => <RankRow r={item} />}
        ListHeaderComponent={<View style={{ marginBottom: space.md }}>{header}</View>}
        ListEmptyComponent={<EmptyState icon="podium" title="No scores yet" body="Points appear as soon as the first matches of the period finish." />}
        ListFooterComponent={<Disclaimer compact />}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl }}
        refreshControl={<RefreshControl refreshing={lb.refreshing} onRefresh={lb.refresh} tintColor={t.brand} />}
        initialNumToRender={15}
        windowSize={9}
      />
      {lb.data?.me && !meVisible ? (
        <View style={{ padding: space.md, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.bg }}>
          <RankRow r={lb.data.me} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** Device mode: no server, so no global ranking. Show the player's own record instead. */
function MyPoints() {
  const t = useTheme();
  const pts = useApi<LocalPoints>('/local/points', { maxAge: 30 });
  const me = useApi<Me>('/me', { maxAge: 30 });
  const s = me.data?.stats;
  const thisWeek = pts.data?.weeks.find((w) => w.key === pts.data?.current_week);
  return (
    <SafeAreaView edges={[]} style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={pts.data?.weeks ?? []}
        keyExtractor={(w) => w.key}
        refreshControl={<RefreshControl refreshing={pts.refreshing} onRefresh={pts.refresh} tintColor={t.brand} />}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl }}
        ListHeaderComponent={
          <View style={{ paddingTop: space.md, gap: space.md, marginBottom: space.md }}>
            <Text v="title">Your points</Text>
            <Row style={{ flexWrap: 'wrap' }}>
              <StatTile label="This week" value={String(thisWeek?.points ?? 0)} color={t.brand} sub={`${thisWeek?.correct ?? 0}/${thisWeek?.picks ?? 0} correct`} />
              <StatTile label={`Season ${pts.data?.season ?? ''}`} value={String(pts.data?.season_points ?? 0)} />
              <StatTile label="Streak" value={`${s?.current_streak ?? 0}🔥`} sub={`best ${s?.best_streak ?? 0}`} />
            </Row>
            <Card>
              <Row style={{ alignItems: 'flex-start' }}>
                <Icon name="earth" color={t.textDim} />
                <Text v="small" dim style={{ flex: 1 }}>
                  Your picks and points are kept on this phone. Competing on global, friends and private-league leaderboards needs the MK Sports server, which can be connected later.
                </Text>
              </Row>
            </Card>
            <Text v="label" dim>
              By week
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Row style={{ minHeight: TAP, paddingHorizontal: space.md, borderRadius: radius.md, marginBottom: 6, backgroundColor: t.surface }} gap={space.md}>
            <Text style={{ flex: 1, fontWeight: '600' }}>Week {item.key.split('-W')[1]}, {item.key.split('-W')[0]}</Text>
            <Text v="small" dim>
              {item.correct}/{item.picks} correct{item.exact ? ` · ${item.exact} exact` : ''}
            </Text>
            <Text v="h3" style={{ minWidth: 40, textAlign: 'right' }}>
              {item.points}
            </Text>
          </Row>
        )}
        ListEmptyComponent={<EmptyState icon="hand-pointing-right" title="No settled picks yet" body="Make picks before kick-off; points appear here as soon as the results are in." action="Find a match" onAction={() => router.push('/sports')} />}
        ListFooterComponent={<Disclaimer compact />}
      />
    </SafeAreaView>
  );
}

export default function LeaderboardScreen() {
  return DATA_MODE === 'device' ? <MyPoints /> : <GlobalLeaderboard />;
}
