/**
 * Quick Picks: a deck of upcoming matches. Swipe a card towards the team you think wins (left = home,
 * right = away), up for a draw, down to skip; or use the buttons. After each call the AI's own call is
 * revealed. Picks go through the same free-to-play pick API as the match page (no money, no prizes).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, PanResponder, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { invalidate, useApi } from '@/api/cache';
import { api } from '@/api/client';
import type { GameSummary, MatchCard, Outcome, PredictionsList } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { Backdrop } from '@/components/glass';
import { TeamBadge } from '@/components/match';
import { Confetti, Float, haptic, Pop, PressableScale } from '@/components/motion';
import { Button, EmptyState, Icon, Loading, Row, Text } from '@/components/ui';
import { dayLabel, kickoffTime, pct } from '@/lib/format';
import { alpha, forWhiteText, matchColors, mix, radius, space, useTheme } from '@/theme/theme';

const { width: W, height: H } = Dimensions.get('window');
const THRESH = W * 0.28;
const CARD_BASE = '#0B1020';
type Decision = Outcome | 'skip';
type Reveal = { m: MatchCard; pick: Outcome; saved: boolean; error?: string; badges?: string[] };
const BADGE_NAMES: Record<string, string> = {
  'first-pick': 'First Pick', 'first-win': 'On the Board', sharpshooter: 'Sharpshooter', 'streak-3': 'Hat-trick', 'streak-5': 'On Fire',
  'streak-10': 'Unstoppable', 'half-century': 'Half Century', centurion: 'Centurion', 'multi-sport': 'All-Rounder', 'beat-the-ai': 'Beat the AI',
};

function nameOf(m: MatchCard, o: Outcome) {
  return o === 'home' ? m.home.short_name : o === 'away' ? m.away.short_name : 'Draw';
}

/** One match card: crests, names, kick-off, and the swipe hints. */
function DeckCard({ m, drag }: { m: MatchCard; drag?: Animated.ValueXY }) {
  const t = useTheme();
  const [hc, ac] = matchColors(m.home.color, m.away.color, t);
  const hint = (o: 'home' | 'away' | 'draw') =>
    drag
      ? o === 'home'
        ? drag.x.interpolate({ inputRange: [-THRESH, -20, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' })
        : o === 'away'
          ? drag.x.interpolate({ inputRange: [0, 20, THRESH], outputRange: [0, 0, 1], extrapolate: 'clamp' })
          : drag.y.interpolate({ inputRange: [-THRESH, -20, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' })
      : 0;
  const stamp = (o: 'home' | 'away' | 'draw', label: string, color: string, pos: object) => (
    <Animated.View pointerEvents="none" style={[styles.stamp, pos, { borderColor: color, opacity: hint(o) }]}>
      <Text v="display" color={color} style={{ fontSize: 30, lineHeight: 32 }}>
        {label}
      </Text>
    </Animated.View>
  );
  return (
    <View
      style={[styles.card, { backgroundColor: CARD_BASE, borderColor: alpha('#FFFFFF', 0.16) }]}
      accessible
      accessibilityLabel={`${m.home.name} versus ${m.away.name}, ${m.league.short_name}, ${dayLabel(new Date(m.start_time))} at ${kickoffTime(m.start_time)}. Who wins? Use the buttons below to pick.`}
    >
      {/* a dark base in both themes, team colours darkened as needed, so the white text stays readable */}
      <LinearGradient colors={[forWhiteText(mix(hc, CARD_BASE, 0.3)), alpha(hc, 0.12), alpha(ac, 0.12), forWhiteText(mix(ac, CARD_BASE, 0.3))]} locations={[0, 0.45, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Text v="label" color={alpha('#FFFFFF', 0.85)} style={{ textAlign: 'center' }}>
        {m.league.short_name}
      </Text>
      <Text v="h2" color="#fff" style={{ textAlign: 'center', marginTop: 2 }}>
        {dayLabel(new Date(m.start_time))} · {kickoffTime(m.start_time)}
      </Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: space.lg }}>
        {(['home', 'away'] as const).map((side) => (
          <View key={side} style={{ alignItems: 'center', width: '44%' }}>
            <Float distance={6} duration={side === 'home' ? 1700 : 2100}>
              <TeamBadge team={m[side]} size={92} plate />
            </Float>
            <Text v="title" color="#fff" numberOfLines={2} adjustsFontSizeToFit style={{ textAlign: 'center', marginTop: space.md }}>
              {m[side].short_name}
            </Text>
          </View>
        ))}
      </View>
      <Text v="hero" color="#fff" style={{ textAlign: 'center' }}>
        WHO WINS?
      </Text>
      <Text v="small" color={alpha('#FFFFFF', 0.75)} style={{ textAlign: 'center', marginTop: 2 }}>
        ← {m.home.short_name} · ↑ draw · {m.away.short_name} → · ↓ skip
      </Text>
      {/* each stamp sits on the edge that stays on screen while the card moves away */}
      {stamp('home', m.home.code, hc, { top: 64, right: 18, transform: [{ rotate: '12deg' }] })}
      {stamp('away', m.away.code, ac, { top: 64, left: 18, transform: [{ rotate: '-12deg' }] })}
      {stamp('draw', 'DRAW', '#FFFFFF', { bottom: 120, alignSelf: 'center' })}
    </View>
  );
}

export default function PlayScreen() {
  const t = useTheme();
  const { me, signedIn, acceptConsent } = useAuth();
  const list = useApi<PredictionsList>('/predictions?days=4', { maxAge: 120 });
  const gameApi = useApi<GameSummary>('/me/game', { maxAge: 10 });
  const [index, setIndex] = useState(0);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [made, setMade] = useState<{ id: string; pick: Outcome; ai: Outcome | null }[]>([]);
  const [burst, setBurst] = useState(0);
  const pos = useRef(new Animated.ValueXY()).current;
  // the reveal fades after a few seconds (undo stays possible while it shows)
  useEffect(() => {
    if (!reveal) return;
    const id = setTimeout(() => setReveal(null), reveal.badges?.length ? 6000 : 4500);
    return () => clearTimeout(id);
  }, [reveal]);

  // the deck: upcoming matches with a prediction that you have not picked yet (frozen once loaded)
  const deck = useMemo(() => (list.data?.items ?? []).filter((m) => m.prediction && !m.my_pick && !m.locked && !m.offline).slice(0, 25), [list.data]);
  const current = deck[index];
  const hasDraw = (m?: MatchCard) => (m ? m.prediction?.draw !== null && m.prediction?.draw !== undefined : false);

  const decide = useCallback(
    async (d: Decision) => {
      const m = deck[index];
      if (!m) return;
      setIndex((i) => i + 1);
      pos.setValue({ x: 0, y: 0 });
      if (d === 'skip') {
        haptic.select();
        return;
      }
      haptic.thud();
      setReveal({ m, pick: d, saved: false });
      try {
        const res = await api<{ new_badges?: string[] }>(`/picks/${m.id}`, { method: 'PUT', body: { pick: d } });
        const badges = (res?.new_badges ?? []).map((b) => BADGE_NAMES[b] ?? b);
        setMade((x) => [...x, { id: m.id, pick: d, ai: m.prediction?.pick ?? null }]);
        setReveal({ m, pick: d, saved: true, badges });
        const ai = m.prediction;
        AccessibilityInfo.announceForAccessibility(
          `Saved: ${nameOf(m, d)}.` + (ai ? ` The AI picked ${nameOf(m, ai.pick)}.` : '') + (badges?.length ? ` Badge unlocked: ${badges.join(', ')}.` : ''),
        );
        invalidate((k) => k.startsWith('/feed') || k.startsWith('/matches') || k.startsWith('/me') || k.startsWith('/picks'));
        if (badges.length || index + 1 >= deck.length) {
          haptic.success();
          setBurst((b) => b + 1);
        }
      } catch (e) {
        setReveal({ m, pick: d, saved: false, error: e instanceof Error ? e.message : 'Could not save' });
      }
    },
    [deck, index, pos],
  );

  const undo = useCallback(async () => {
    if (!reveal?.saved) return;
    haptic.tap();
    try {
      await api(`/picks/${reveal.m.id}`, { method: 'DELETE' });
      setMade((x) => x.filter((p) => p.id !== reveal.m.id));
      setIndex((i) => Math.max(0, i - 1));
      setReveal(null);
      invalidate((k) => k.startsWith('/feed') || k.startsWith('/matches') || k.startsWith('/me') || k.startsWith('/picks'));
    } catch {
      // keep the pick if it cannot be removed
    }
  }, [reveal]);

  const fling = useCallback(
    (d: Decision) => {
      const to = d === 'home' ? { x: -W * 1.4, y: 40 } : d === 'away' ? { x: W * 1.4, y: 40 } : d === 'draw' ? { x: 0, y: -H } : { x: 0, y: H };
      Animated.timing(pos, { toValue: to, duration: 260, useNativeDriver: false }).start(() => decide(d));
    },
    [decide, pos],
  );
  const flingRef = useRef(fling);
  flingRef.current = fling;
  const drawRef = useRef(false);
  drawRef.current = hasDraw(current);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
        onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_, g) => {
          if (g.dx > THRESH || g.vx > 0.9) flingRef.current('away');
          else if (g.dx < -THRESH || g.vx < -0.9) flingRef.current('home');
          else if (drawRef.current && (g.dy < -THRESH || g.vy < -0.9)) flingRef.current('draw');
          else if (g.dy > THRESH * 1.2 || g.vy > 1.1) flingRef.current('skip');
          else Animated.spring(pos, { toValue: { x: 0, y: 0 }, useNativeDriver: false, friction: 5, tension: 60 }).start();
        },
      }),
    [pos],
  );

  const header = (
    <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.sm }}>
      <PressableScale onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityLabel="Close" style={styles.round}>
        <Icon name="close" size={22} color={t.text} />
      </PressableScale>
      <View style={{ alignItems: 'center' }}>
        <Text v="h2">QUICK PICKS</Text>
        {deck.length ? (
          <Text v="tiny" dim style={{ fontWeight: '700' }}>
            {Math.min(index + 1, deck.length)} of {deck.length} · free to play
          </Text>
        ) : null}
      </View>
      <View style={[styles.round, { backgroundColor: alpha(t.gold, 0.16) }]}>
        <Text v="h2" color={t.gold} style={{ fontSize: 18 }}>
          {gameApi.data?.level.level ?? 1}
        </Text>
      </View>
    </Row>
  );

  let body: React.ReactNode;
  if (!signedIn) {
    body = <EmptyState icon="account-outline" title="Sign in to play" body="Quick Picks is free. Call the matches, beat the AI, climb the levels." action="Sign in" onAction={() => router.replace('/sign-in')} />;
  } else if (me && !me.consented) {
    body = (
      <View style={{ flex: 1, justifyContent: 'center', padding: space.xl }}>
        <Pop>
          <Text v="hero" style={{ textAlign: 'center' }}>
            CALL IT.
          </Text>
        </Pop>
        <Text dim style={{ textAlign: 'center', marginTop: space.md }}>
          Swipe each match towards the team you think wins. Then see if you beat the AI. Free to play: no money, no prizes, just bragging rights. Predictions are for entertainment, not betting advice.
        </Text>
        <Button title="I agree, let's play" onPress={() => acceptConsent(false)} style={{ marginTop: space.xl }} />
      </View>
    );
  } else if (list.loading && !list.data) {
    body = <Loading label="Shuffling the deck…" />;
  } else if (!current) {
    const against = made.filter((p) => p.ai && p.ai !== p.pick).length;
    body = (
      <View style={{ flex: 1, justifyContent: 'center', padding: space.xl }}>
        <Pop>
          <Text v="hero" style={{ textAlign: 'center' }}>
            {made.length ? 'ALL CALLED!' : 'ALL CAUGHT UP'}
          </Text>
        </Pop>
        <Text dim style={{ textAlign: 'center', marginTop: space.md }}>
          {made.length
            ? `You made ${made.length} pick${made.length === 1 ? '' : 's'}${against ? `, ${against} against the AI. Bold.` : ', all with the AI.'} Results land here after full time.`
            : 'No open matches left to call right now. New fixtures appear as kick-offs approach.'}
        </Text>
        <Button title="My game" icon="trophy-outline" onPress={() => router.replace('/leaderboard')} style={{ marginTop: space.xl }} />
        <Button title="Back home" kind="secondary" onPress={() => router.replace('/')} style={{ marginTop: space.sm }} />
      </View>
    );
  } else {
    const rot = pos.x.interpolate({ inputRange: [-W, 0, W], outputRange: ['-14deg', '0deg', '14deg'] });
    body = (
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, marginHorizontal: space.lg, marginTop: space.md }}>
          {[2, 1].map((k) =>
            deck[index + k] ? (
              <View key={deck[index + k].id} pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ scale: 1 - k * 0.05 }, { translateY: k * 16 }], opacity: 1 - k * 0.25 }]}>
                <DeckCard m={deck[index + k]} />
              </View>
            ) : null,
          )}
          <Animated.View key={current.id} {...pan.panHandlers} style={[StyleSheet.absoluteFill, { transform: [{ translateX: pos.x }, { translateY: pos.y }, { rotate: rot }] }]}>
            <DeckCard m={current} drag={pos} />
          </Animated.View>
        </View>
        <Row style={{ justifyContent: 'center', paddingVertical: space.lg }} gap={space.md}>
          <PressableScale onPress={() => fling('home')} accessibilityLabel={`Pick ${current.home.name} to win`} accessibilityHint="Saves your pick and shows the AI's call" style={[styles.choice, { borderColor: matchColors(current.home.color, current.away.color, t)[0] }]}>
            <Text v="h2" numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 18 }}>
              {current.home.code}
            </Text>
          </PressableScale>
          {hasDraw(current) ? (
            <PressableScale onPress={() => fling('draw')} accessibilityLabel="Pick a draw" accessibilityHint="Saves your pick and shows the AI's call" style={[styles.choice, { borderColor: t.draw }]}>
              <Text v="h2" style={{ fontSize: 18 }}>
                DRAW
              </Text>
            </PressableScale>
          ) : null}
          <PressableScale onPress={() => fling('away')} accessibilityLabel={`Pick ${current.away.name} to win`} accessibilityHint="Saves your pick and shows the AI's call" style={[styles.choice, { borderColor: matchColors(current.home.color, current.away.color, t)[1] }]}>
            <Text v="h2" numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 18 }}>
              {current.away.code}
            </Text>
          </PressableScale>
          <PressableScale onPress={() => fling('skip')} accessibilityLabel="Skip this match" feedback="select" style={[styles.round, { width: 52, height: 52 }]}>
            <Icon name="debug-step-over" size={22} color={t.textDim} />
          </PressableScale>
        </Row>
      </View>
    );
  }

  const ai = reveal?.m.prediction;
  const same = reveal && ai ? ai.pick === reveal.pick : false;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Backdrop height={520} />
      <SafeAreaView style={{ flex: 1 }}>
        {header}
        {body}
        {reveal ? (
          <Pop key={`${reveal.m.id}-${reveal.saved}`} style={[styles.toast, { backgroundColor: t.glassStrong, borderColor: reveal.error ? t.loss : same ? t.brand : t.hot }]}>
            <Icon name={reveal.error ? 'alert-circle' : 'robot-outline'} size={26} color={reveal.error ? t.loss : same ? t.brand : t.hot} />
            <View style={{ flex: 1 }}>
              <Text v="small" style={{ fontWeight: '800' }} numberOfLines={1}>
                You: {nameOf(reveal.m, reveal.pick)}
                {ai ? ` · AI: ${nameOf(reveal.m, ai.pick)} ${pct(ai.pick === 'home' ? ai.home : ai.pick === 'away' ? ai.away : ai.draw)}` : ''}
              </Text>
              <Text v="tiny" dim numberOfLines={1}>
                {reveal.error ?? (!ai ? 'Saved.' : same ? 'Same call as the AI 🤝' : 'Going against the AI. Bold! 🔥')}
              </Text>
              {reveal.badges?.length ? (
                <Text v="tiny" color={t.gold} style={{ fontWeight: '900' }} numberOfLines={1}>
                  🏅 Badge unlocked: {reveal.badges.join(', ')}
                </Text>
              ) : null}
            </View>
            {reveal.saved ? (
              <PressableScale onPress={undo} feedback="select" accessibilityLabel="Undo your last pick" style={{ paddingHorizontal: space.sm, paddingVertical: 6 }}>
                <Text v="small" color={t.brand} style={{ fontWeight: '900' }}>
                  UNDO
                </Text>
              </PressableScale>
            ) : null}
          </Pop>
        ) : null}
      </SafeAreaView>
      <Confetti burst={burst} colors={[t.brand, t.hot, t.gold, t.violet, t.accent2]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // userSelect: a mouse drag on the web must move the card, not select its text
  card: { flex: 1, borderRadius: radius.xl + 4, borderWidth: 1, padding: space.xl, overflow: 'hidden', ...(Platform.OS === 'web' ? ({ userSelect: 'none' } as object) : null) },
  stamp: { position: 'absolute', borderWidth: 3, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 2 },
  choice: { minWidth: 72, height: 52, paddingHorizontal: space.md, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  round: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  toast: { position: 'absolute', left: space.lg, right: space.lg, bottom: 96, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1.5 },
});
