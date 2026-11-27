/** F1 picks: the podium for the next race. 5 points per driver in the right place, 2 on the podium elsewhere, 5 more for all three. */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView } from 'react-native';

import { invalidate, useApi } from '@/api/cache';
import { api, ApiError } from '@/api/client';
import type { F1Board, F1Standing, GameSummary, SpecialPick } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { Button, Card, Disclaimer, EmptyState, Icon, Loading, Row, Text } from '@/components/ui';
import { dayLabel, kickoffTime } from '@/lib/format';
import { radius, space, TAP, useTheme } from '@/theme/theme';

const PLACES = ['1st', '2nd', '3rd'];

export default function F1PickScreen() {
  const t = useTheme();
  const { me, acceptConsent } = useAuth();
  const board = useApi<F1Board>('/f1', { maxAge: 120 });
  const standings = useApi<{ drivers: F1Standing[]; constructors: F1Standing[] }>('/f1/standings', { maxAge: 3600 });
  const summary = useApi<GameSummary>('/me/game', { maxAge: 10 });
  const [podium, setPodium] = useState<(string | null)[]>([null, null, null]);
  const [slot, setSlot] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = Date.now();
  const target = (board.data?.current ?? [])
    .map((w) => ({ w, race: w.sessions.find((s) => /race/i.test(s.name) && s.state === 'pre' && Date.parse(s.start) > now) }))
    .find((x) => x.race);
  const id = target ? `f1:${target.w.id}` : null;
  const existing = (summary.data?.specials ?? []).find((s): s is Extract<SpecialPick, { kind: 'f1' }> => s.id === id && s.kind === 'f1');
  useEffect(() => {
    if (existing) setPodium([...existing.podium]);
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (board.loading || standings.loading) return <Loading />;
  if (me && !me.consented) return <EmptyState icon="shield-check-outline" title="One more step" body="The pick game is free to play, with no real money." action="I agree, let me play" onAction={() => acceptConsent(false)} />;
  if (!target || !id) return <EmptyState icon="flag-checkered" title="No race to predict right now" body="Podium picks open during a race weekend and lock when the race starts." />;
  const drivers = standings.data?.drivers ?? [];
  // the weekend's entry list when the feed has it (qualifying order), otherwise the championship standings
  const entry = target.w.sessions.flatMap((s) => s.results.map((r) => r.driver)).filter(Boolean);
  const names = [...new Set(entry.length >= 10 ? entry : drivers.map((d) => d.name))];

  const choose = (name: string) => {
    const next = podium.map((p) => (p === name ? null : p));
    next[slot] = name;
    setPodium(next);
    const empty = next.findIndex((p) => !p);
    if (empty >= 0) setSlot(empty);
  };
  const save = async () => {
    if (podium.some((p) => !p)) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/specials/f1`, { method: 'PUT', body: { weekend_id: target.w.id, name: target.w.name, start: target.race!.start, podium } });
      invalidate((k) => k.startsWith('/me'));
      router.canGoBack() ? router.back() : router.replace('/leaderboard');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your pick');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}>
      <Text v="h2">{target.w.name}</Text>
      <Row gap={4} style={{ marginTop: 2 }}>
        <Icon name="lock-clock" size={14} color={t.pending} />
        <Text v="small" color={t.pending}>
          Locks when the race starts · {dayLabel(new Date(target.race!.start))} {kickoffTime(target.race!.start)}
        </Text>
      </Row>
      <Row gap={space.sm} style={{ marginTop: space.lg }}>
        {PLACES.map((pl, i) => (
          <Pressable
            key={pl}
            onPress={() => setSlot(i)}
            accessibilityRole="button"
            accessibilityState={{ selected: slot === i }}
            accessibilityLabel={`${pl} place: ${podium[i] ?? 'empty'}`}
            style={{ flex: 1, minHeight: 74, borderRadius: radius.md, borderWidth: 2, borderColor: slot === i ? t.brand : t.border, backgroundColor: t.surface, padding: space.sm, justifyContent: 'center' }}
          >
            <Text v="label" color={i === 0 ? t.gold : t.textDim}>
              {pl}
            </Text>
            <Text style={{ fontWeight: '800' }} numberOfLines={2}>
              {podium[i] ?? 'Choose'}
            </Text>
          </Pressable>
        ))}
      </Row>
      <Text v="small" dim style={{ marginTop: space.sm }}>
        Tap a place, then a driver.
      </Text>
      <Card style={{ marginTop: space.md, paddingVertical: 4 }}>
        {names.map((n, i) => {
          const at = podium.indexOf(n);
          return (
            <Pressable key={n} onPress={() => choose(n)} accessibilityRole="button" accessibilityLabel={`${n}${at >= 0 ? `, picked ${PLACES[at]}` : ''}`} style={{ minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 1 : 0, borderColor: t.glassBorder }}>
              <Text style={{ flex: 1, fontWeight: at >= 0 ? '800' : '500' }}>{n}</Text>
              {at >= 0 ? (
                <Text v="label" color={at === 0 ? t.gold : t.brand}>
                  {PLACES[at]}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </Card>
      {error ? (
        <Text color={t.loss} style={{ marginTop: space.md }}>
          {error}
        </Text>
      ) : null}
      <Button title={existing ? 'Update podium' : 'Lock in podium'} icon="check" onPress={save} disabled={podium.some((p) => !p)} loading={saving} style={{ marginTop: space.lg }} />
      <Text v="tiny" muted style={{ textAlign: 'center', marginTop: space.md }}>
        5 points for each driver in the right place, 2 for a driver on the podium in another place, 5 more for all three right (up to 20). You can change it until the race starts. There are no AI predictions for F1, so these picks don&apos;t count in you vs the AI.
      </Text>
      <Disclaimer compact />
    </ScrollView>
  );
}

export { ErrorBoundary } from '@/components/route-error';
