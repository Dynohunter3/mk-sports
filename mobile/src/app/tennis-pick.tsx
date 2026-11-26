/** Tennis picks: the winner (3 points) and the number of sets (2 more). */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView } from 'react-native';

import { invalidate, useApi } from '@/api/cache';
import { api, ApiError } from '@/api/client';
import type { GameSummary, SpecialPick, TennisBoard } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { Button, Disclaimer, EmptyState, Icon, Loading, Row, Text } from '@/components/ui';
import { dayLabel, kickoffTime } from '@/lib/format';
import { radius, space, useTheme } from '@/theme/theme';

/** Men's Grand Slam singles are best of five sets; everything else on the tours is best of three. */
function bestOfFor(tour: 'atp' | 'wta', major: boolean, draw: string): 3 | 5 {
  return tour === 'atp' && major && /singles/i.test(draw) && !/mixed/i.test(draw) ? 5 : 3;
}

export default function TennisPickScreen() {
  const t = useTheme();
  const { tour: tourRaw, id } = useLocalSearchParams<{ tour: string; id: string }>();
  const tour = tourRaw === 'wta' ? 'wta' : 'atp';
  const { me, acceptConsent } = useAuth();
  const board = useApi<TennisBoard>(`/tennis/${tour}`, { maxAge: 60 });
  const summary = useApi<GameSummary>('/me/game', { maxAge: 10 });
  const [winner, setWinner] = useState<0 | 1 | null>(null);
  const [sets, setSets] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickId = `tennis:${tour}:${id}`;
  const existing = (summary.data?.specials ?? []).find((s): s is Extract<SpecialPick, { kind: 'tennis' }> => s.id === pickId && s.kind === 'tennis');
  useEffect(() => {
    if (existing) {
      setWinner(existing.winner);
      setSets(existing.sets);
    }
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (board.loading) return <Loading />;
  if (me && !me.consented) return <EmptyState icon="shield-check-outline" title="One more step" body="The pick game is free to play, with no real money." action="I agree, let me play" onAction={() => acceptConsent(false)} />;
  const m = board.data?.matches.find((x) => x.id === id);
  if (!m) return <EmptyState icon="tennis" title="Match not found" body="It may have finished or left this week's schedule." />;
  const major = board.data?.tournaments.find((x) => x.name === m.tournament)?.major ?? false;
  const bestOf = bestOfFor(tour, major, m.draw);
  const minSets = Math.ceil(bestOf / 2);
  const locked = m.state !== 'pre' || Date.parse(m.start) <= Date.now();
  const save = async () => {
    if (winner === null || sets === null) return;
    setSaving(true);
    setError(null);
    try {
      await api('/specials/tennis', { method: 'PUT', body: { tour, match_id: m.id, name: `${m.tournament} · ${m.round ?? ''}`.replace(/ · $/, ''), start: m.start, players: [m.players[0].name, m.players[1].name], winner, sets, best_of: bestOf } });
      invalidate((k) => k.startsWith('/me'));
      router.canGoBack() ? router.back() : router.replace('/leaderboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your pick');
    } finally {
      setSaving(false);
    }
  };
  const option = (label: string, on: boolean, onPress: () => void, a11y: string) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={locked}
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled: locked }}
      accessibilityLabel={a11y}
      style={{ flex: 1, minHeight: 60, borderRadius: radius.md, borderWidth: 2, borderColor: on ? t.brand : t.border, backgroundColor: on ? t.brand + '22' : t.surface, alignItems: 'center', justifyContent: 'center', padding: space.sm }}
    >
      <Text style={{ fontWeight: '800', textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}>
      <Text v="label" dim>
        {[m.tournament, m.round].filter(Boolean).join(' · ')}
      </Text>
      <Text v="h2" style={{ marginTop: 2 }}>
        {m.players[0].name} v {m.players[1].name}
      </Text>
      <Row gap={4} style={{ marginTop: 2 }}>
        <Icon name={locked ? 'lock' : 'lock-clock'} size={14} color={locked ? t.live : t.pending} />
        <Text v="small" color={locked ? t.live : t.pending}>
          {locked ? 'Locked: the match has started' : `Locks at the start · ${dayLabel(new Date(m.start))} ${kickoffTime(m.start)}`}
        </Text>
      </Row>
      <Text v="label" dim style={{ marginTop: space.xl, marginBottom: space.sm }}>
        Who wins?
      </Text>
      <Row gap={space.sm}>{m.players.map((p, i) => option(p.name, winner === i, () => setWinner(i as 0 | 1), `${p.name} wins`))}</Row>
      <Text v="label" dim style={{ marginTop: space.xl, marginBottom: space.sm }}>
        In how many sets? (best of {bestOf})
      </Text>
      <Row gap={space.sm}>{Array.from({ length: bestOf - minSets + 1 }, (_, k) => minSets + k).map((n) => option(`${n} sets`, sets === n, () => setSets(n), `${n} sets`))}</Row>
      {error ? (
        <Text color={t.loss} style={{ marginTop: space.md }}>
          {error}
        </Text>
      ) : null}
      <Button title={existing ? 'Update pick' : 'Lock in pick'} icon="check" onPress={save} disabled={winner === null || sets === null || locked} loading={saving} style={{ marginTop: space.xl }} />
      <Text v="tiny" muted style={{ textAlign: 'center', marginTop: space.md }}>
        3 points for the winner, 2 more for the number of sets as well. A retirement is settled on the sets played; a walkover is void. There are no AI predictions for tennis, so these picks don&apos;t count in you vs the AI.
      </Text>
      <Disclaimer compact />
    </ScrollView>
  );
}
