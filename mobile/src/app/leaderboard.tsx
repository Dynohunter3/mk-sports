import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useState } from 'react';
import { Animated, FlatList, RefreshControl, ScrollView, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api/cache';
import { DATA_MODE } from '@/api/client';
import type { GamePick, GameSummary, Leaderboard, LeaderboardRow, LocalPoints, Outcome } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { Backdrop, Glass } from '@/components/glass';
import { CountUp, FadeIn, Pop, PressableScale, useGrow } from '@/components/motion';
import { Button, Card, Chip, ChipRow, Disclaimer, EmptyState, Icon, Loading, Row, SectionHeader, Segmented, StatTile, StatusBanner, Text } from '@/components/ui';
import { flag, initials } from '@/lib/format';
import { alpha, radius, space, TAP, useTheme } from '@/theme/theme';

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

/** A back button and a title for screens without the stack header. */
function TopBar({ title }: { title: string }) {
  const t = useTheme();
  return (
    <Row style={{ paddingHorizontal: space.lg, paddingVertical: space.sm }} gap={space.md}>
      <PressableScale onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityLabel="Back" style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(t.text, 0.08) }}>
        <Icon name="arrow-left" size={22} color={t.text} />
      </PressableScale>
      <Text v="title">{title}</Text>
    </Row>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Level ring: the XP towards the next level fills in around the level number. */
function LevelRing({ level, progress, size = 108, color }: { level: number; progress: number; size?: number; color: string }) {
  const grow = useGrow(200, 1100);
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={9} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={9}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={grow.interpolate({ inputRange: [0, 1], outputRange: [c, c * (1 - Math.max(0.02, Math.min(1, progress)))] })}
        />
      </Svg>
      <Text v="tiny" color="rgba(255,255,255,0.8)" style={{ fontWeight: '800', letterSpacing: 1 }}>
        LEVEL
      </Text>
      <Text v="hero" color="#fff" style={{ fontSize: 44, lineHeight: 46 }}>
        {level}
      </Text>
    </View>
  );
}

/** Device mode: the player's own game: level, you vs the AI, streaks, badges, results. */
function MyGame() {
  const t = useTheme();
  const g = useApi<GameSummary>('/me/game', { maxAge: 10 });
  const pts = useApi<LocalPoints>('/local/points', { maxAge: 30 });
  const d = g.data;
  const weeks = (pts.data?.weeks ?? []).slice(-8);
  const maxWeek = Math.max(1, ...weeks.map((w) => w.points));
  const oc = (p: GamePick) => {
    const [h, a] = p.final_score ?? [0, 0];
    return h > a ? 'home' : h < a ? 'away' : 'draw';
  };
  const name = (p: GamePick, o: Outcome | null) => (o === 'home' ? p.home_code : o === 'away' ? p.away_code : o === 'draw' ? 'Draw' : '–');
  if (g.loading && !d) return <Loading label="Loading your game…" />;
  const vs = d?.vs_ai;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Backdrop height={460} />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <TopBar title="MY GAME" />
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }} refreshControl={<RefreshControl refreshing={g.refreshing} onRefresh={g.refresh} tintColor={t.brand} />}>
          {/* level */}
          <FadeIn>
            <LinearGradient colors={[t.violet, t.hot]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.lg, overflow: 'hidden' }}>
              <View style={{ position: 'absolute', right: -40, top: -40, width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.10)' }} />
              <LevelRing level={d?.level.level ?? 1} progress={d?.level.progress ?? 0} color={t.gold} />
              <View style={{ flex: 1 }}>
                <Text v="display" color="#fff">
                  {(d?.level.name ?? 'Rookie').toUpperCase()}
                </Text>
                <CountUp value={d?.level.points ?? 0} render={(v) => <Text v="h2" color="#fff">{Math.round(v)} PTS</Text>} />
                <Text v="small" color="rgba(255,255,255,0.85)" style={{ marginTop: 4 }}>
                  {d?.level.next && d.level.to !== null ? `${d.level.to - d.level.points} pt${d.level.to - d.level.points === 1 ? '' : 's'} to ${d.level.next}` : 'Top level reached. GOAT status.'}
                </Text>
              </View>
            </LinearGradient>
          </FadeIn>

          {/* you vs the AI */}
          <FadeIn delay={80}>
            <Glass style={{ marginTop: space.md }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text v="label">You vs the AI</Text>
                <Icon name="sword-cross" size={20} color={t.hot} />
              </Row>
              <Row style={{ justifyContent: 'center', marginTop: space.sm }} gap={space.lg}>
                <View style={{ alignItems: 'center' }}>
                  <Text v="tiny" dim style={{ fontWeight: '800' }}>
                    YOU
                  </Text>
                  <CountUp value={vs?.you ?? 0} render={(v) => <Text v="hero" color={t.brand} style={{ fontSize: 56, lineHeight: 60 }}>{Math.round(v)}</Text>} />
                </View>
                <Text v="display" muted>
                  –
                </Text>
                <View style={{ alignItems: 'center' }}>
                  <Text v="tiny" dim style={{ fontWeight: '800' }}>
                    AI
                  </Text>
                  <CountUp value={vs?.ai ?? 0} render={(v) => <Text v="hero" color={t.hot} style={{ fontSize: 56, lineHeight: 60 }}>{Math.round(v)}</Text>} />
                </View>
              </Row>
              <Text v="small" dim style={{ textAlign: 'center' }}>
                {!vs?.matches
                  ? 'Make picks to take on the AI. Every settled match counts.'
                  : vs.leader === 'you'
                    ? `You're ahead! You beat the AI on ${vs.you_beat_ai} match${vs.you_beat_ai === 1 ? '' : 'es'}.`
                    : vs.leader === 'ai'
                      ? `The AI leads. It beat you on ${vs.ai_beat_you}; you beat it on ${vs.you_beat_ai}.`
                      : `Dead level after ${vs.matches} matches.`}
              </Text>
              <Button title="Quick Picks" icon="cards-playing-outline" onPress={() => router.push('/play')} style={{ marginTop: space.md }} />
              <Button title="Private leagues" icon="account-group" kind="secondary" onPress={() => router.push('/private-leagues')} style={{ marginTop: space.sm }} />
            </Glass>
          </FadeIn>

          {/* streak, accuracy, exact scores */}
          <FadeIn delay={140}>
            <Row style={{ marginTop: space.md }}>
              <StatTile label="Streak" value={`${d?.stats.current_streak ?? 0}🔥`} sub={`best ${d?.stats.best_streak ?? 0}`} color={t.gold} />
              <StatTile label="Correct" value={d?.stats.accuracy !== null && d?.stats.accuracy !== undefined ? `${Math.round(d.stats.accuracy * 100)}%` : '–'} sub={`${d?.stats.picks_correct ?? 0}/${d?.stats.picks_settled ?? 0}`} color={t.brand} />
              <StatTile label="Exact" value={String(d?.stats.exact_scores ?? 0)} sub="scores" color={t.accent2} />
            </Row>
          </FadeIn>

          {/* this week's banker */}
          <Card style={{ marginTop: space.lg, borderColor: d?.banker ? alpha(t.gold, 0.7) : t.glassBorder, borderWidth: 1 }}>
            <Row gap={space.md}>
              <Text style={{ fontSize: 26 }}>⭐</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800' }}>{d?.banker ? `Banker: ${d.banker.home} v ${d.banker.away}` : 'No banker this week'}</Text>
                <Text v="small" dim>
                  {d?.banker
                    ? d.banker.status === 'pending'
                      ? 'Double points if your pick is right.'
                      : `${d.banker.status === 'won' ? 'Won' : 'Lost'}: ${d.banker.points} points.`
                    : 'Pick a match you are sure about and switch on "Make this my banker" for double points.'}
                </Text>
              </View>
            </Row>
          </Card>

          {/* badges */}
          <SectionHeader title={`Badges · ${(d?.badges ?? []).filter((b) => b.awarded_at).length}/${d?.badges.length ?? 0}`} icon="medal-outline" color={t.gold} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {(d?.badges ?? []).map((b, i) => {
              const on = !!b.awarded_at;
              return (
                <Pop key={b.slug} delay={i * 40} style={{ width: '31.5%' }}>
                  <View style={{ alignItems: 'center', padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? alpha(t.gold, 0.6) : t.glassBorder, backgroundColor: on ? alpha(t.gold, 0.12) : t.glass, minHeight: 104, opacity: on ? 1 : 0.55 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? alpha(t.gold, 0.22) : alpha(t.text, 0.06) }}>
                      <Icon name={on ? b.icon : 'lock'} size={24} color={on ? t.gold : t.textMuted} />
                    </View>
                    <Text v="small" style={{ fontWeight: '800', textAlign: 'center', marginTop: 4 }} numberOfLines={1}>
                      {b.name}
                    </Text>
                    <Text v="tiny" muted style={{ textAlign: 'center' }} numberOfLines={2}>
                      {b.description}
                    </Text>
                  </View>
                </Pop>
              );
            })}
          </View>

          {/* recent results */}
          <SectionHeader title="Recent results" icon="history" />
          {(d?.recent ?? []).length ? (
            (d?.recent ?? []).map((p, i) => {
              const won = p.status === 'won';
              const o = oc(p);
              const beat = won && p.ai_pick && p.ai_pick !== o;
              return (
                <FadeIn key={p.match_id} delay={i * 40}>
                  <Row style={{ padding: space.md, borderRadius: radius.md, marginBottom: 6, backgroundColor: t.glass, borderWidth: 1, borderColor: won ? alpha(t.win, 0.45) : t.glassBorder }} gap={space.md}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: won ? t.win : p.status === 'void' ? t.draw : t.loss }}>
                      <Icon name={won ? 'check-bold' : p.status === 'void' ? 'minus' : 'close-thick'} size={18} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '800' }} numberOfLines={1}>
                        {p.home} {p.final_score ? `${p.final_score[0]}–${p.final_score[1]}` : 'v'} {p.away}
                      </Text>
                      <Text v="tiny" dim numberOfLines={1}>
                        You: {name(p, p.pick)} · AI: {name(p, p.ai_pick)}
                        {beat ? ' · beat the AI 🤖' : ''}
                      </Text>
                    </View>
                    <Text v="h2" color={won ? t.win : t.textMuted}>
                      +{p.points}
                    </Text>
                  </Row>
                </FadeIn>
              );
            })
          ) : (
            <EmptyState icon="cards-playing-outline" title="No results yet" body="Your picks are graded after full time. Start with a few Quick Picks." action="Quick Picks" onAction={() => router.push('/play')} />
          )}

          {/* weekly points */}
          {weeks.length ? (
            <>
              <SectionHeader title="Points by week" icon="chart-bar" color={t.accent2} />
              <Glass>
                {weeks.map((w) => (
                  <Row key={w.key} style={{ minHeight: 30 }} gap={space.sm}>
                    <Text v="tiny" dim style={{ width: 54, fontWeight: '700' }}>
                      Wk {w.key.split('-W')[1]}
                    </Text>
                    <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: alpha(t.text, 0.06), overflow: 'hidden' }}>
                      <View style={{ width: `${(w.points / maxWeek) * 100}%`, height: '100%', borderRadius: 5, backgroundColor: t.accent2 }} />
                    </View>
                    <Text v="small" style={{ width: 36, textAlign: 'right', fontWeight: '800' }}>
                      {w.points}
                    </Text>
                  </Row>
                ))}
              </Glass>
            </>
          ) : null}

          {/* season archive */}
          {(d?.seasons ?? []).length ? (
            <>
              <SectionHeader title="Season archive" icon="archive-outline" color={t.violet} />
              {(d?.seasons ?? []).map((s) => (
                <Glass key={s.season} style={{ marginBottom: space.sm, borderColor: s.current ? alpha(t.violet, 0.6) : undefined }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text v="h2" style={{ fontSize: 20 }}>
                      {s.season.replace('-', '–')}
                      {s.current ? ' · this season' : ''}
                    </Text>
                    <Text v="h2" style={{ fontSize: 20 }} color={t.gold}>
                      {s.points} pts
                    </Text>
                  </Row>
                  <Text v="small" dim style={{ marginTop: 2 }}>
                    {s.correct} of {s.picks} right{s.accuracy !== null ? ` (${Math.round(s.accuracy * 100)}%)` : ''} · {s.exact} exact {s.exact === 1 ? 'score' : 'scores'} · best streak {s.best_streak}
                    {s.bankers ? ` · bankers ${s.bankers_won}/${s.bankers}` : ''}
                  </Text>
                </Glass>
              ))}
            </>
          ) : null}

          <Card style={{ marginTop: space.lg }}>
            <Row style={{ alignItems: 'flex-start' }}>
              <Icon name="cellphone-lock" color={t.textDim} />
              <Text v="small" dim style={{ flex: 1 }}>
                Your picks, points and badges are kept on this phone: back them up in Settings, under Privacy. To play friends, start a private league.
              </Text>
            </Row>
          </Card>
          <Disclaimer compact />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export default function LeaderboardScreen() {
  if (DATA_MODE === 'device') return <MyGame />;
  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView edges={['top']}>
        <TopBar title="LEADERBOARD" />
      </SafeAreaView>
      <GlobalLeaderboard />
    </View>
  );
}
