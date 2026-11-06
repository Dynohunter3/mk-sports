import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, TextInput, View } from 'react-native';

import { invalidate, useApi } from '@/api/cache';
import { api, ApiError, OfflineError } from '@/api/client';
import type { MatchDetail, Outcome, PickResult } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { sportOf } from '@/data/leagues';
import { ProbabilityBar, TeamBadge } from '@/components/match';
import { Button, Card, Disclaimer, EmptyState, Icon, Loading, Row, Text } from '@/components/ui';
import { notify } from '@/lib/dialogs';
import { clampScore, outcomeLabel, relative, rulesText } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { usePrefs } from '@/state/prefs';
import { radius, space, TAP, useTheme } from '@/theme/theme';

const BADGE_NAMES: Record<string, string> = {
  'first-pick': 'First Pick',
  'first-win': 'On the Board',
  sharpshooter: 'Sharpshooter',
};

export default function PickScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { me, signedIn, mode, acceptConsent } = useAuth();
  const { prefs, update } = usePrefs();
  const { data: m, loading } = useApi<MatchDetail>(`/matches/${id}`, { maxAge: 60 });
  const now = useNow(1000);
  const [pick, setPick] = useState<Outcome | null>(null);
  const [withScore, setWithScore] = useState(false);
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!m) return;
    const p = m.my_pick;
    if (p) {
      setPick(p.pick);
      if (p.home_score !== null && p.away_score !== null) {
        setWithScore(true);
        setHome(p.home_score);
        setAway(p.away_score);
      }
    } else if (m.prediction) {
      setHome(m.prediction.score[0]);
      setAway(m.prediction.score[1]);
    }
  }, [m?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Loading />;
  if (!m) return <EmptyState title="Match unavailable" />;
  if (!signedIn) {
    return (
      <EmptyState
        icon="account-lock-outline"
        title="Sign in to play"
        body="The pick game is free. Make picks before kick-off, earn points and climb the leaderboard."
        action="Sign in or create account"
        onAction={() => router.replace('/sign-in')}
      />
    );
  }
  if (me && !me.consented) {
    return mode === 'device' ? (
      <EmptyState
        icon="shield-check-outline"
        title="One more step"
        body="The pick game is free to play, with no real money. Predictions are for entertainment, not betting advice. Your picks are stored only on this phone."
        action="I agree, let me play"
        onAction={() => acceptConsent(false)}
      />
    ) : (
      <EmptyState icon="shield-check-outline" title="One more step" body="Please accept the terms and privacy policy to make picks." action="Review & accept" onAction={() => router.replace('/sign-in')} />
    );
  }

  const locked = m.locked || new Date(m.start_time).getTime() <= now;
  const sportDef = sportOf(m.sport);
  const max = sportDef?.maxScore || 200;
  const stepper = sportDef?.stepper ?? m.sport === 'football';
  const step = 1;
  const outcomes: Outcome[] = m.has_draws ? ['home', 'draw', 'away'] : ['home', 'away'];
  const implied: Outcome = home > away ? 'home' : away > home ? 'away' : 'draw';
  const scoreConflict = withScore && pick !== null && implied !== pick;

  const setScore = (side: 'home' | 'away', v: number) => {
    const val = clampScore(v, max);
    const h = side === 'home' ? val : home;
    const a = side === 'away' ? val : away;
    side === 'home' ? setHome(val) : setAway(val);
    // keep the outcome consistent with the score the user is typing
    setPick(h > a ? 'home' : a > h ? 'away' : m.has_draws ? 'draw' : pick);
  };

  async function submit() {
    if (!pick || !m) return;
    if (withScore && !m.has_draws && home === away) {
      setError('Basketball has no draws: the scores must differ.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api<PickResult>(`/picks/${m.id}`, { method: 'PUT', body: withScore ? { pick, home_score: home, away_score: away } : { pick } });
      invalidate((k) => k.startsWith('/feed') || k.startsWith('/matches') || k.startsWith('/me') || k.startsWith('/picks'));
      if (res.new_badges.length) notify('Badge unlocked! 🏅', res.new_badges.map((b) => BADGE_NAMES[b] ?? b).join(', '));
      (router.canGoBack() ? router.back() : router.replace(`/match/${m.id}`));
    } catch (e) {
      setError(e instanceof OfflineError ? "You're offline. Your pick wasn't saved, so try again when you're connected." : e instanceof ApiError ? e.message : 'Could not save your pick');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!m) return;
    setSaving(true);
    try {
      await api(`/picks/${m.id}`, { method: 'DELETE' });
      invalidate((k) => k.startsWith('/feed') || k.startsWith('/matches') || k.startsWith('/me'));
      (router.canGoBack() ? router.back() : router.replace(`/match/${m.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove pick');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
      <Row style={{ justifyContent: 'center', gap: space.lg }}>
        <TeamBadge team={m.home} size={40} />
        <Text v="h3" dim>
          vs
        </Text>
        <TeamBadge team={m.away} size={40} />
      </Row>
      <Text v="h3" style={{ textAlign: 'center', marginTop: space.sm }}>
        {m.home.name} v {m.away.name}
      </Text>
      <Row style={{ justifyContent: 'center', marginTop: 4 }} gap={4}>
        <Icon name={locked ? 'lock' : 'lock-clock'} size={14} color={locked ? t.live : t.pending} />
        <Text v="small" color={locked ? t.live : t.pending}>
          {locked ? 'Locked: the match has started' : `Locks at kick-off · ${relative(new Date(m.start_time).getTime(), now).replace('in ', '')} left`}
        </Text>
      </Row>

      <Text v="label" dim style={{ marginTop: space.xl, marginBottom: space.sm }}>
        Who wins?
      </Text>
      <Row gap={space.sm}>
        {outcomes.map((o) => {
          const on = pick === o;
          return (
            <Pressable
              key={o}
              disabled={locked}
              onPress={() => {
                setPick(o);
                if (withScore && implied !== o) {
                  // nudge the score to match the chosen outcome
                  if (o === 'home') setHome(Math.max(home, away + 1));
                  else if (o === 'away') setAway(Math.max(away, home + 1));
                  else setAway(home);
                }
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: locked }}
              style={({ pressed }) => [
                { flex: 1, minHeight: 64, borderRadius: radius.md, borderWidth: 2, alignItems: 'center', justifyContent: 'center', padding: space.sm },
                { borderColor: on ? t.brand : t.border, backgroundColor: on ? t.brand + '22' : t.surface, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={{ fontWeight: '800', textAlign: 'center', fontSize: 14 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                {outcomeLabel(o, m.home.short_name, m.away.short_name)}
              </Text>
              <Text v="tiny" muted>
                {o === 'home' ? 'Home win' : o === 'away' ? 'Away win' : 'Draw'}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      <Card style={{ marginTop: space.lg }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>Predict the exact score</Text>
            <Text v="small" dim>
              Optional bonus: {rulesText(m.scoring, m.has_draws).split(', ').slice(1).join(', ') || 'no bonus for this sport'}
            </Text>
          </View>
          <Switch
            value={withScore}
            onValueChange={(on) => {
              setWithScore(on);
              // a pre-filled score implies the outcome if none was chosen yet
              if (on && !pick && (m.has_draws || home !== away)) setPick(implied);
            }}
            disabled={locked}
            accessibilityLabel="Predict the exact score"
          />
        </Row>
        {withScore ? (
          <Row style={{ justifyContent: 'center', marginTop: space.lg, gap: space.lg }}>
            <ScoreInput label={m.home.code} value={home} onChange={(v) => setScore('home', v)} stepper={stepper} step={step} disabled={locked} />
            <Text v="h2" dim>
              –
            </Text>
            <ScoreInput label={m.away.code} value={away} onChange={(v) => setScore('away', v)} stepper={stepper} step={step} disabled={locked} />
          </Row>
        ) : null}
        {scoreConflict ? (
          <Text v="small" color={t.pending} style={{ marginTop: space.sm }}>
            That score means {outcomeLabel(implied, m.home.short_name, m.away.short_name)}: adjust it or your pick.
          </Text>
        ) : null}
      </Card>

      {m.prediction ? (
        <Card style={{ marginTop: space.lg }}>
          <Row style={{ justifyContent: 'space-between', marginBottom: prefs.showAiOnPickScreen ? space.md : 0 }}>
            <Row>
              <Icon name="robot-outline" />
              <Text style={{ fontWeight: '700' }}>AI prediction</Text>
            </Row>
            <Pressable onPress={() => update({ showAiOnPickScreen: !prefs.showAiOnPickScreen })} hitSlop={12} style={{ minHeight: TAP, justifyContent: 'center' }}>
              <Text v="small" color={t.brand} style={{ fontWeight: '700' }}>
                {prefs.showAiOnPickScreen ? 'Hide' : 'Show'}
              </Text>
            </Pressable>
          </Row>
          {prefs.showAiOnPickScreen ? (
            <>
              <ProbabilityBar p={m.prediction} home={m.home.short_name} away={m.away.short_name} />
              <Text v="small" dim style={{ marginTop: space.sm }}>
                Most likely score {m.prediction.score[0]}-{m.prediction.score[1]} ({m.prediction.confidence} confidence). Beat the AI by picking against it, and earn a badge when you're right.
              </Text>
            </>
          ) : null}
        </Card>
      ) : null}

      {!pick && !locked ? (
        <Text v="small" dim style={{ marginTop: space.lg, textAlign: 'center' }}>
          Choose who wins to lock in your pick.
        </Text>
      ) : null}
      {error ? (
        <Text color={t.loss} style={{ marginTop: space.lg }}>
          {error}
        </Text>
      ) : null}
      <Button title={m.my_pick ? 'Update pick' : 'Lock in pick'} onPress={submit} disabled={!pick || locked || scoreConflict} loading={saving} style={{ marginTop: space.xl }} icon="check" />
      {m.my_pick && !locked ? <Button title="Remove pick" kind="ghost" onPress={remove} style={{ marginTop: space.sm }} /> : null}
      <Text v="tiny" muted style={{ textAlign: 'center', marginTop: space.md }}>
        {rulesText(m.scoring, m.has_draws)}. You can change your pick until kick-off.
      </Text>
      <Disclaimer compact />
    </ScrollView>
  );
}

function ScoreInput({ label, value, onChange, stepper, step, disabled }: { label: string; value: number; onChange: (v: number) => void; stepper: boolean; step: number; disabled?: boolean }) {
  const t = useTheme();
  const btn = (delta: number, icon: string) => (
    <Pressable
      onPress={() => onChange(value + delta)}
      disabled={disabled}
      accessibilityLabel={`${delta > 0 ? 'Increase' : 'Decrease'} ${label} score`}
      style={({ pressed }) => ({ width: TAP, height: TAP, borderRadius: TAP / 2, backgroundColor: t.surface2, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
    >
      <Icon name={icon} size={22} color={t.text} />
    </Pressable>
  );
  return (
    <View style={{ alignItems: 'center', gap: space.sm }}>
      <Text v="label" dim>
        {label}
      </Text>
      {stepper ? (
        <>
          {btn(step, 'plus')}
          <Text style={{ fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{value}</Text>
          {btn(-step, 'minus')}
        </>
      ) : (
        <TextInput
          value={String(value)}
          onChangeText={(v) => onChange(parseInt(v.replace(/\D/g, '') || '0', 10))}
          keyboardType="number-pad"
          maxLength={3}
          editable={!disabled}
          accessibilityLabel={`${label} score`}
          style={{ width: 88, minHeight: 56, textAlign: 'center', fontSize: 28, fontWeight: '800', color: t.text, backgroundColor: t.surface2, borderRadius: radius.md }}
        />
      )}
    </View>
  );
}
