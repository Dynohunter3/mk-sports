/** The game on Home: results to celebrate, the Quick Picks hero, and the level / streak chips. */
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { invalidate } from '@/api/cache';
import { api } from '@/api/client';
import type { GamePick, GameSummary, MatchCard } from '@/api/types';
import { alpha, matchColors, radius, space, useDarkPalette, useTheme } from '@/theme/theme';

import { TeamBadge } from './match';
import { Float, haptic, Pop, PressableScale } from './motion';
import { Icon, Row, Text } from './ui';

const outcome = (p: GamePick) => {
  const [h, a] = p.final_score ?? [0, 0];
  return h > a ? 'home' : h < a ? 'away' : 'draw';
};

async function markSeen(ids: string[]) {
  await api('/me/game/seen', { method: 'POST', body: { ids } }).catch(() => undefined);
  invalidate((k) => k.startsWith('/me'));
}

/** "Results are in!": settled picks you have not seen yet. Fires `onCelebrate` once (for confetti). */
export function ResultsCelebration({ game, onCelebrate }: { game: GameSummary | undefined; onCelebrate: () => void }) {
  const t = useTheme();
  const items = game?.unseen ?? [];
  const fired = useRef(false);
  const won = items.filter((p) => p.status === 'won');
  useEffect(() => {
    if (items.length && !fired.current) {
      fired.current = true;
      if (won.length) {
        haptic.success();
        onCelebrate();
      }
    }
  }, [items.length, won.length, onCelebrate]);
  if (!items.length) return null;
  const points = items.reduce((s, p) => s + p.points, 0);
  const beat = won.filter((p) => p.ai_pick && p.ai_pick !== outcome(p)).length;
  const ids = items.map((p) => p.match_id);
  return (
    <Pop style={{ marginTop: space.md }}>
      <LinearGradient colors={won.length ? [t.gold, t.hot] : [t.violet, '#3B2A7A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: space.lg, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', right: -30, top: -30, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.14)' }} />
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text v="label" color="rgba(255,255,255,0.9)">
              Results are in
            </Text>
            <Text v="hero" color="#fff">
              {won.length ? `+${points} PTS` : 'NOT THIS TIME'}
            </Text>
            <Text v="small" color="rgba(255,255,255,0.92)" style={{ fontWeight: '700' }}>
              {won.length} of {items.length} right{beat ? ` · beat the AI ${beat}×` : ''}
            </Text>
          </View>
          <PressableScale onPress={() => markSeen(ids)} accessibilityLabel="Dismiss" feedback="select" style={{ padding: 6 }}>
            <Icon name="close" size={22} color="#fff" />
          </PressableScale>
        </Row>
        <View style={{ marginTop: space.md, gap: 6 }}>
          {items.slice(0, 4).map((p) => {
            const ok = p.status === 'won';
            const name = (o: string | null) => (o === 'home' ? p.home_code : o === 'away' ? p.away_code : 'Draw');
            return (
              <Row key={p.match_id} style={{ backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: radius.md, padding: 8 }} gap={8}>
                <Icon name={ok ? 'check-circle' : 'close-circle'} size={20} color={ok ? '#C6FFE0' : 'rgba(255,255,255,0.75)'} />
                <Text v="small" color="#fff" style={{ flex: 1, fontWeight: '800' }} numberOfLines={1}>
                  {p.home} {p.final_score ? `${p.final_score[0]}–${p.final_score[1]}` : ''} {p.away}
                </Text>
                <Text v="tiny" color="rgba(255,255,255,0.9)" style={{ fontWeight: '800' }}>
                  {name(p.pick)} · +{p.points}
                </Text>
              </Row>
            );
          })}
        </View>
        <PressableScale
          onPress={() => {
            markSeen(ids);
            router.push('/leaderboard');
          }}
          style={{ marginTop: space.md, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: 8 }}
        >
          <Text v="h2" color="#fff" style={{ fontSize: 17, lineHeight: 20 }}>
            SEE MY GAME →
          </Text>
        </PressableScale>
      </LinearGradient>
    </Pop>
  );
}

/** The Quick Picks hero: a fanned stack of the next matches and the you-vs-AI score. */
export function PlayHero({ game, next }: { game: GameSummary | undefined; next: MatchCard[] }) {
  const t = useDarkPalette(); // the card is bright with dark text in both modes
  const vs = game?.vs_ai;
  const fan = next.slice(0, 3);
  return (
    <PressableScale onPress={() => router.push('/play')} accessibilityLabel="Quick Picks: call the next matches" scaleTo={0.97} style={{ marginTop: space.md }}>
      <LinearGradient colors={[t.brand, t.accent2, t.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: space.lg, minHeight: 168, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: -60, bottom: -80, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.12)' }} />
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, paddingRight: space.sm }}>
            <Text v="label" color="rgba(4,18,11,0.75)">
              Free to play · beat the AI
            </Text>
            <Text v="hero" color="#04120B">
              QUICK PICKS
            </Text>
            <Text v="small" color="rgba(4,18,11,0.85)" style={{ fontWeight: '700' }}>
              Swipe to call the next matches.
            </Text>
            <Row style={{ marginTop: space.md }} gap={8}>
              <View style={{ backgroundColor: '#04120B', borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="play" size={16} color={t.brand} />
                <Text v="h2" color="#fff" style={{ fontSize: 17, lineHeight: 20 }}>
                  PLAY
                </Text>
              </View>
              {vs?.matches ? (
                <Text v="h2" color="#04120B" style={{ fontSize: 18 }}>
                  YOU {vs.you}–{vs.ai} AI
                </Text>
              ) : null}
            </Row>
          </View>
          <Float distance={6} duration={2000} style={{ width: 112, height: 130, justifyContent: 'center' }}>
            {(fan.length ? fan : [null, null, null]).map((m, i) => {
              const [hc, ac] = m ? matchColors(m.home.color, m.away.color, t) : [t.brand, t.pending];
              return (
                <View
                  key={m?.id ?? i}
                  style={{
                    position: 'absolute',
                    right: i * 14,
                    top: 8 + i * 6,
                    width: 82,
                    height: 108,
                    borderRadius: 14,
                    backgroundColor: '#0B1430',
                    borderWidth: 2,
                    borderColor: 'rgba(255,255,255,0.85)',
                    transform: [{ rotate: `${(i - 1) * -10}deg` }],
                    overflow: 'hidden',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    zIndex: 3 - i,
                  }}
                >
                  <LinearGradient colors={[alpha(hc, 0.85), alpha(ac, 0.85)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
                  {m ? (
                    <>
                      <TeamBadge team={m.home} size={30} plate />
                      <Text v="h2" color="#fff" style={{ fontSize: 14, lineHeight: 16 }}>
                        VS
                      </Text>
                      <TeamBadge team={m.away} size={30} plate />
                    </>
                  ) : (
                    <Icon name="soccer" size={34} color="#fff" />
                  )}
                </View>
              );
            })}
          </Float>
        </View>
      </LinearGradient>
    </PressableScale>
  );
}

/** Level and streak, side by side (Home header). */
export function GameChips({ game }: { game: GameSummary | undefined }) {
  const t = useTheme();
  if (!game) return null;
  return (
    <Row gap={8}>
      <PressableScale onPress={() => router.push('/leaderboard')} accessibilityLabel={`Level ${game.level.level}, ${game.level.name}`} feedback="select" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: alpha(t.gold, 0.16), borderColor: alpha(t.gold, 0.5), borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 }}>
        <Icon name="star-four-points" size={14} color={t.gold} />
        <Text v="h2" color={t.gold} style={{ fontSize: 15, lineHeight: 18 }}>
          LV {game.level.level} · {game.level.name.toUpperCase()}
        </Text>
      </PressableScale>
      {game.stats.current_streak > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: alpha(t.hot, 0.16), borderColor: alpha(t.hot, 0.5), borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text style={{ fontSize: 13 }}>🔥</Text>
          <Text v="h2" color={t.hot} style={{ fontSize: 15, lineHeight: 18 }}>
            {game.stats.current_streak}
          </Text>
        </View>
      ) : null}
    </Row>
  );
}
