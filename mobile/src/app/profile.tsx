import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DATA_MODE } from '@/api/client';
import { usePaged } from '@/api/paged';
import type { MatchCard, MyPick } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { MatchRow } from '@/components/match';
import { Button, Card, Disclaimer, EmptyState, Icon, Row, SectionHeader, Segmented, StatTile, Text } from '@/components/ui';
import { flag, initials, pct } from '@/lib/format';
import { radius, space, TAP, useTheme } from '@/theme/theme';

type Filter = 'all' | 'pending' | 'settled';
type HistoryItem = { match: MatchCard; pick: MyPick; created_at: string; id?: number };

function Links() {
  const t = useTheme();
  const items = [
    { icon: 'chart-bell-curve', label: 'Model accuracy', href: '/accuracy' },
    { icon: 'shield-account', label: 'Private leagues', href: '/private-leagues' },
    { icon: 'cog-outline', label: 'Settings & privacy', href: '/settings' },
  ] as const;
  return (
    <Card style={{ paddingVertical: 4 }}>
      {items.map((it, i) => (
        <Pressable key={it.href} onPress={() => router.push(it.href)} style={{ minHeight: TAP + 4, flexDirection: 'row', alignItems: 'center', gap: space.md, borderTopWidth: i ? 1 : 0, borderColor: t.border }} accessibilityRole="link">
          <Icon name={it.icon} />
          <Text style={{ flex: 1 }}>{it.label}</Text>
          <Icon name="chevron-right" />
        </Pressable>
      ))}
    </Card>
  );
}

export default function ProfileScreen() {
  const t = useTheme();
  const { me, signedIn, refreshMe } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const history = usePaged<HistoryItem>(signedIn ? `/me/picks?status=${filter}&limit=20` : null, { maxAge: 60 });

  useFocusEffect(
    useCallback(() => {
      if (signedIn) refreshMe();
    }, [signedIn, refreshMe]),
  );

  if (!signedIn || !me) {
    return (
      <SafeAreaView edges={[]} style={{ flex: 1, backgroundColor: t.bg, padding: space.lg }}>
        <Text v="title" style={{ marginTop: space.md }}>
          Profile
        </Text>
        <Card style={{ marginTop: space.lg, alignItems: 'center', gap: space.md }}>
          <Icon name="trophy-variant-outline" size={44} color={t.brand} />
          <Text v="h3" style={{ textAlign: 'center' }}>
            Play the free prediction game
          </Text>
          <Text dim style={{ textAlign: 'center' }}>
            Make picks before kick-off, earn points, build streaks and badges, and see how you rank against everyone.
          </Text>
          <Button title="Sign in or create account" icon="login" onPress={() => router.push('/sign-in')} style={{ alignSelf: 'stretch' }} />
        </Card>
        <View style={{ height: space.lg }} />
        <Links />
        <Disclaimer />
      </SafeAreaView>
    );
  }

  const s = me.stats;
  const earned = me.badges.filter((b) => b.awarded_at);
  const header = (
    <View style={{ paddingTop: space.md }}>
      <Row gap={space.md}>
        <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
          <Text v="h2" color={t.brandText}>
            {initials(me.display_name)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text v="h2">
            {me.display_name} {flag(me.country)}
          </Text>
          <Text v="small" dim>
            {s.global_rank_season ? `#${s.global_rank_season} this season · ` : ''}
            {s.total_points} points
          </Text>
        </View>
      </Row>
      <Row style={{ flexWrap: 'wrap', marginTop: space.lg }}>
        <StatTile label="Points" value={String(s.total_points)} color={t.brand} />
        <StatTile label="Accuracy" value={pct(s.accuracy)} sub={`${s.picks_correct}/${s.picks_settled}`} />
        <StatTile label="Streak" value={`${s.current_streak}🔥`} sub={`best ${s.best_streak}`} />
      </Row>
      <Row style={{ flexWrap: 'wrap', marginTop: space.sm }}>
        <StatTile label="Exact scores" value={String(s.exact_scores)} />
        <StatTile label="Open picks" value={String(s.pending_picks)} />
        {DATA_MODE === 'device' ? (
          <StatTile label="Badges" value={`${earned.length}/${me.badges.length}`} />
        ) : (
          <StatTile label="Season rank" value={s.global_rank_season ? `#${s.global_rank_season}` : '–'} />
        )}
      </Row>

      <SectionHeader title={`Badges · ${earned.length}/${me.badges.length}`} icon="medal-outline" />
      <Row style={{ flexWrap: 'wrap' }} gap={space.sm}>
        {me.badges.map((b) => {
          const on = !!b.awarded_at;
          return (
            <View
              key={b.slug}
              accessible
              accessibilityLabel={`${b.name}: ${b.description}${on ? ', earned' : ', not earned yet'}`}
              style={{ width: '31%', minHeight: 92, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? t.pending : t.border, backgroundColor: on ? t.pending + '14' : t.surface, alignItems: 'center', opacity: on ? 1 : 0.45 }}
            >
              <Icon name={b.icon} size={26} color={on ? t.pending : t.textMuted} />
              <Text v="tiny" style={{ fontWeight: '700', textAlign: 'center', marginTop: 4 }} numberOfLines={1}>
                {b.name}
              </Text>
              <Text v="tiny" muted style={{ textAlign: 'center', fontSize: 10 }} numberOfLines={2}>
                {b.description}
              </Text>
            </View>
          );
        })}
      </Row>

      <SectionHeader title="Pick history" icon="history" />
      <Segmented
        options={[
          { value: 'all', label: 'All' },
          { value: 'pending', label: 'Open' },
          { value: 'settled', label: 'Settled' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <View style={{ height: space.md }} />
    </View>
  );

  return (
    <SafeAreaView edges={[]} style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={history.items}
        keyExtractor={(it) => `${it.match.id}`}
        renderItem={({ item }) => <MatchRow m={{ ...item.match, my_pick: item.pick }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={history.loading ? <ActivityIndicator color={t.brand} /> : <EmptyState icon="hand-pointing-right" title="No picks here yet" body="Open any upcoming match and tap “Make your pick”." />}
        ListFooterComponent={
          <View>
            {history.loadingMore ? <ActivityIndicator color={t.brand} style={{ margin: space.md }} /> : null}
            <View style={{ height: space.lg }} />
            <Links />
            <Disclaimer />
          </View>
        }
        onEndReached={history.loadMore}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl }}
        initialNumToRender={6}
        windowSize={7}
      />
    </SafeAreaView>
  );
}
