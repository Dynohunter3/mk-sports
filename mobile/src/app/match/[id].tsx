import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api/cache';
import type { FormGame, Injury, LineupPlayer, MatchCentre, MatchDetail, TeamStat, TimelineItem } from '@/api/types';
import { Glass } from '@/components/glass';
import { ConfidencePill, finalLabel, FormPills, ProbabilityBar, StandingsTable, StatusChip, TeamBadge, TierPill } from '@/components/match';
import { kitColors, Pitch, ShotMap } from '@/components/pitch';
import { PlayerPhoto } from '@/components/crest';
import { Float, PressableScale } from '@/components/motion';
import { Button, Disclaimer, EmptyState, Icon, Loading, Row, SectionHeader, Segmented, StatusBanner, Text } from '@/components/ui';
import { confirm, notify } from '@/lib/dialogs';
import { dayLabel, kickoffTime, outcomeLabel, relative, rulesText } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { NOTIFY_SUPPORTED, requestPermission } from '@/notify/notifications';
import { usePrefs } from '@/state/prefs';
import { alpha, LeagueTheme, matchColors, mix, radius, space, TAP, useTheme } from '@/theme/theme';

type Tab = 'overview' | 'lineups' | 'stats' | 'timeline' | 'table';

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const league = id?.split('~')[0] ?? null;
  return (
    <LeagueTheme league={league}>
      <Stack.Screen options={{ headerShown: false }} />
      <Match id={id} />
    </LeagueTheme>
  );
}

function Match({ id }: { id: string }) {
  const t = useTheme();
  const { prefs } = usePrefs();
  const [poll, setPoll] = useState(0);
  const detail = useApi<MatchDetail>(`/matches/${id}`, { maxAge: 20, poll });
  const m = detail.data;
  const centre = useApi<MatchCentre>(m ? `/matches/${id}/centre` : null, { maxAge: 20, poll, persist: m?.status !== 'live' });
  const [tabRaw, setTab] = useState<Tab | null>(null);
  // poll only while the match is in progress (and not in data-saver mode)
  useEffect(() => setPoll(m?.status === 'live' && !prefs.dataSaver ? 20 : 0), [m?.status, prefs.dataSaver]);

  if (detail.loading) return <Loading />;
  if (!m) return <EmptyState icon="alert-circle-outline" title="Match unavailable" body={detail.error} action="Retry" onAction={detail.refresh} />;
  const c = centre.data;
  const football = m.sport === 'football';
  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: m.status === 'scheduled' ? 'Preview' : 'Overview' },
    ...(football ? [{ value: 'lineups' as Tab, label: 'Lineups' }] : []),
    { value: 'stats', label: 'Stats' },
    ...(football ? [{ value: 'timeline' as Tab, label: 'Timeline' }] : []),
    ...(m.standings.length ? [{ value: 'table' as Tab, label: 'Table' }] : []),
  ];
  const tab: Tab = tabRaw ?? (m.status === 'live' && football && c?.lineups ? 'lineups' : 'overview');
  const refresh = () => {
    detail.refresh();
    centre.refresh();
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxl }} refreshControl={<RefreshControl refreshing={detail.refreshing} onRefresh={refresh} tintColor="#fff" />} stickyHeaderIndices={[1]}>
        <MatchHero m={m} xg={c?.xg ?? null} />
        <View style={{ backgroundColor: t.bg, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: 4 }}>
          <Segmented scroll options={tabs} value={tab} onChange={setTab} />
        </View>
        <View style={{ paddingHorizontal: space.lg }}>
          <StatusBanner error={detail.error ?? centre.error} offline={detail.offline} updatedAt={detail.updatedAt} onRetry={refresh} />
          {tab === 'overview' ? <Overview m={m} /> : null}
          {tab === 'lineups' ? <Lineups m={m} c={c} loading={centre.loading} /> : null}
          {tab === 'stats' ? <Stats m={m} c={c} loading={centre.loading} /> : null}
          {tab === 'timeline' ? <Timeline m={m} c={c} loading={centre.loading} /> : null}
          {tab === 'table' ? (
            <Glass style={{ marginTop: space.md }}>
              <StandingsTable rows={m.standings} highlight={[m.home.id, m.away.id]} sport={m.sport} onTeam={(tm) => router.push({ pathname: '/team/[id]', params: { id: tm.id, league: m.league.id } })} />
            </Glass>
          ) : null}
          <Text v="tiny" muted style={{ marginTop: space.lg }}>
            Data: ESPN (fixtures, scores, line-ups, match stats, tables, team news, matchup predictor). xG and forecasts: MK Sports models; betting-market consensus is used inside forecasts but odds are never shown. MK Sports is not affiliated with these sources.
          </Text>
          <Disclaimer />
        </View>
      </ScrollView>
    </View>
  );
}

// ------------------------------------------------------------------ header
function MatchHero({ m, xg }: { m: MatchDetail; xg: MatchCentre['xg'] }) {
  const t = useTheme();
  const started = m.status === 'live' || m.status === 'finished';
  const quarters = m.score_detail.quarters;
  const [hc, ac] = matchColors(m.home.color, m.away.color, t);
  const team = (tm: MatchDetail['home'], side: 'home' | 'away') => (
    <PressableScale onPress={() => router.push({ pathname: '/team/[id]', params: { id: tm.id, league: m.league.id } })} accessibilityRole="button" accessibilityLabel={`${tm.name} team page`} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
      <Float distance={5} duration={side === 'home' ? 1900 : 2300}>
        <View style={{ width: 88, height: 88, alignItems: 'center', justifyContent: 'center' }}>
          <TeamBadge team={tm} size={84} plate />
        </View>
      </Float>
      <Text v="h2" color="#FFFFFF" style={{ textAlign: 'center', fontSize: 22, lineHeight: 25 }} numberOfLines={2}>
        {tm.short_name.toUpperCase()}
      </Text>
    </PressableScale>
  );
  return (
    <View style={{ overflow: 'hidden' }}>
      {/* a diagonal split in the two teams' colours */}
      <LinearGradient
        colors={[mix(hc, '#000000', 0.15), mix(hc, '#000000', 0.5), mix(ac, '#000000', 0.5), mix(ac, '#000000', 0.15)]}
        locations={[0, 0.49, 0.51, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient colors={['rgba(0,0,0,0)', alpha(t.bg, 0.85)]} start={{ x: 0, y: 0.55 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      <Text v="hero" color="rgba(255,255,255,0.07)" style={{ position: 'absolute', alignSelf: 'center', top: 70, fontSize: 170, lineHeight: 180 }}>
        VS
      </Text>
      <SafeAreaView edges={['top']}>
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
          <Row style={{ justifyContent: 'space-between', minHeight: 44 }}>
            <PressableScale onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="chevron-left" size={26} color="#fff" />
            </PressableScale>
            <Pressable onPress={() => router.push(`/league/${m.league.id}`)} accessibilityRole="link" style={{ flex: 1, alignItems: 'center' }}>
              <Text v="label" color="rgba(255,255,255,0.85)" numberOfLines={1}>
                {m.league_name ?? m.league.short_name}
              </Text>
              {m.round ? (
                <Text v="tiny" color="rgba(255,255,255,0.7)" numberOfLines={1}>
                  {m.round}
                </Text>
              ) : null}
            </Pressable>
            <FollowBell m={m} />
          </Row>
          <Row style={{ alignItems: 'flex-start', marginTop: space.md }}>
            {team(m.home, 'home')}
            <View style={{ minWidth: 118, alignItems: 'center', paddingTop: 10 }}>
              {m.status === 'live' ? (
                <View style={{ paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.35)' }}>
                  <StatusChip m={m} />
                </View>
              ) : (
                <Text v="label" color="rgba(255,255,255,0.85)">
                  {m.status === 'finished' ? finalLabel(m.clock) : m.status === 'scheduled' ? dayLabel(new Date(m.start_time)) : m.status}
                </Text>
              )}
              <Text v={started ? 'hero' : 'display'} color="#FFFFFF" style={started ? { fontSize: 60, lineHeight: 64 } : { fontSize: 40, lineHeight: 44, marginTop: 2 }} accessibilityLabel={started ? `Score ${m.home_score} to ${m.away_score}` : undefined}>
                {started ? `${m.home_score}–${m.away_score}` : kickoffTime(m.start_time)}
              </Text>
              {xg && started ? (
                <Text v="tiny" color="rgba(255,255,255,0.85)" style={{ fontWeight: '800' }}>
                  xG {xg.home.toFixed(2)} – {xg.away.toFixed(2)}
                </Text>
              ) : null}
            </View>
            {team(m.away, 'away')}
          </Row>
          {quarters?.length ? (
            <Text v="tiny" color="rgba(255,255,255,0.75)" style={{ textAlign: 'center', marginTop: space.sm }}>
              {quarters.map((q) => `${q[0]}-${q[1]}`).join('  ·  ')}
            </Text>
          ) : null}
          <Row style={{ justifyContent: 'center', marginTop: space.md, flexWrap: 'wrap' }} gap={12}>
            {m.venue ? (
              <Row gap={4}>
                <Icon name="stadium-variant" size={14} color="rgba(255,255,255,0.75)" />
                <Text v="tiny" color="rgba(255,255,255,0.8)">
                  {m.venue}
                  {m.neutral ? ' (neutral)' : ''}
                </Text>
              </Row>
            ) : null}
            {m.attendance ? (
              <Row gap={4}>
                <Icon name="account-group" size={14} color="rgba(255,255,255,0.75)" />
                <Text v="tiny" color="rgba(255,255,255,0.8)">
                  {m.attendance.toLocaleString()}
                </Text>
              </Row>
            ) : null}
            {m.status === 'live' ? (
              <Text v="tiny" color="#FFFFFF" style={{ fontWeight: '700' }}>
                Live · updates every 20s
              </Text>
            ) : null}
          </Row>
        </View>
      </SafeAreaView>
    </View>
  );
}

/** Bell: alerts for this match (goals, kick-off, full time, a reminder before kick-off). */
function FollowBell({ m }: { m: MatchDetail }) {
  const { prefs, update } = usePrefs();
  const on = prefs.followed.includes(m.id) || (!!prefs.favoriteTeam && (prefs.favoriteTeam.id === m.home.id || prefs.favoriteTeam.id === m.away.id));
  const mine = !!prefs.favoriteTeam && (prefs.favoriteTeam.id === m.home.id || prefs.favoriteTeam.id === m.away.id);
  if (!NOTIFY_SUPPORTED || m.status === 'finished' || m.status === 'cancelled') return <View style={{ width: 40 }} />;
  const toggle = async () => {
    if (mine) return; // your team's matches always alert
    if (prefs.followed.includes(m.id)) {
      update({ followed: prefs.followed.filter((x) => x !== m.id) });
      return;
    }
    if (!(await requestPermission())) {
      const again = await confirm('Notifications are off', 'Allow notifications for MK Sports in your phone settings to follow matches.', 'Open settings');
      if (again) Linking.openSettings().catch(() => undefined);
      return;
    }
    update({ followed: [m.id, ...prefs.followed].slice(0, 50), notify: { ...prefs.notify, matchAlerts: true, reminders: prefs.notify.reminders || m.status === 'scheduled' } });
    notify('Following this match', 'You will get kick-off, goal and full-time alerts. Turn alert types on or off in Settings.');
  };
  const active = on && prefs.notify.matchAlerts;
  return (
    <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={active ? 'Stop following this match' : 'Follow this match'} hitSlop={10} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: active ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={active ? 'bell-ring' : 'bell-outline'} size={22} color={active ? '#0B1430' : '#fff'} />
    </Pressable>
  );
}

function CallRow({ icon, color, title, value }: { icon: string; color: string; title: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', minHeight: 30 }}>
      <Row gap={space.sm} style={{ flex: 1 }}>
        <Icon name={icon as never} size={18} color={color} />
        <Text v="small" style={{ flex: 1 }} numberOfLines={1}>
          {title}
        </Text>
      </Row>
      <Text v="small" dim>
        {value}
      </Text>
    </Row>
  );
}

/** How the published prediction moved since its previous version, and why. */
function Movement({ mv, pick, now, home, away }: { mv: NonNullable<NonNullable<MatchDetail['prediction_full']>['call']>['movement'] & object; pick: 'home' | 'draw' | 'away'; now: { home?: number; draw?: number | null; away?: number }; home: string; away: string }) {
  const t = useTheme();
  const name = (o: 'home' | 'draw' | 'away') => (o === 'home' ? home : o === 'away' ? away : 'Draw');
  const before = mv.from[pick];
  const after = (now[pick] ?? 0) as number;
  const delta = Math.round((after - before) * 100);
  const when = new Date(mv.at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const changed = mv.from_pick && mv.from_pick !== pick;
  if (!changed && Math.abs(delta) < 2) return null; // small moves (e.g. a routine refit) are not worth a line
  const title = changed ? `Call changed: ${name(mv.from_pick!)} → ${name(pick)}` : `${name(pick)}: ${Math.round(before * 100)}% → ${Math.round(after * 100)}%`;
  return (
    <View>
      <CallRow icon={delta > 0 ? 'trending-up' : delta < 0 ? 'trending-down' : 'trending-neutral'} color={delta >= 0 ? t.win : t.loss} title={title} value={`since ${when}`} />
      <Text v="tiny" muted style={{ marginLeft: 26, marginTop: -4 }}>
        Why: {mv.reason}
      </Text>
    </View>
  );
}

/** After full time: was each call right? (result, safer call, goals) */
function Review({ m, p, hs, as }: { m: MatchDetail; p: NonNullable<MatchDetail['prediction_full']>; hs: number; as: number }) {
  const t = useTheme();
  const call = p.call!;
  const o = hs > as ? 'home' : hs < as ? 'away' : 'draw';
  const pick = m.prediction?.pick;
  const rows: [string, boolean][] = [];
  if (pick) rows.push([`Call: ${outcomeLabel(pick, m.home.short_name, m.away.short_name)}`, pick === o]);
  rows.push([`Safer call: ${call.safer.label}`, call.safer.pair.split(' or ').includes(o)]);
  if (p.goals) rows.push([p.goals.over25 >= 0.5 ? 'Over 2.5 goals' : 'Under 2.5 goals', p.goals.over25 >= 0.5 === hs + as > 2.5]);
  return (
    <View style={{ marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassBorder, gap: space.xs }}>
      <Text v="tiny" muted style={{ fontWeight: '700' }}>
        HOW THE CALLS DID · FT {hs}-{as}
      </Text>
      {rows.map(([label, ok]) => (
        <Row key={label} style={{ justifyContent: 'space-between' }}>
          <Text v="small" style={{ flex: 1 }} numberOfLines={1}>
            {label}
          </Text>
          <Text v="small" color={ok ? t.win : t.loss} style={{ fontWeight: '700' }}>
            {ok ? '✓ Right' : '✗ Wrong'}
          </Text>
        </Row>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ overview (prediction, form, news)
function Overview({ m }: { m: MatchDetail }) {
  const t = useTheme();
  const p = m.prediction_full;
  return (
    <View>
      <PickCta m={m} />
      {p ? (
        <>
          <SectionHeader title="AI prediction" icon="robot-outline" />
          <Glass>
            <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
              <View style={{ flex: 1 }}>
                <Text v="tiny" muted>
                  {m.status === 'scheduled' ? 'Most likely' : 'Predicted before kick-off'}
                </Text>
                <Text v="h2">
                  {outcomeLabel(m.prediction!.pick, m.home.short_name, m.away.short_name)} {p.predicted_score[0]}-{p.predicted_score[1]}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                {p.call ? <TierPill tier={p.call.tier} /> : <ConfidencePill level={p.confidence} />}
                {p.correct !== null ? (
                  <Text v="tiny" color={p.correct ? t.win : t.loss} style={{ fontWeight: '700' }}>
                    {p.correct ? '✓ Called it' : '✗ Missed'}
                  </Text>
                ) : null}
              </View>
            </Row>
            <ProbabilityBar p={{ home: p.probabilities.home ?? 0, draw: p.probabilities.draw ?? null, away: p.probabilities.away ?? 0 }} home={m.home.short_name} away={m.away.short_name} height={10} colors={[m.home.color, m.away.color]} />
            <Text dim style={{ marginTop: space.md }}>
              {p.explanation.summary}
            </Text>
            {p.call ? (
              <View style={{ marginTop: space.md, gap: space.sm }}>
                <CallRow
                  icon={p.call.tier === 'strong' ? 'shield-check' : p.call.tier === 'likely' ? 'thumb-up-outline' : p.call.tier === 'lean' ? 'scale-balance' : 'help-circle-outline'}
                  color={p.call.tier === 'strong' ? t.win : p.call.tier === 'likely' ? t.brand : p.call.tier === 'lean' ? t.pending : t.textMuted}
                  title={p.call.tier_label}
                  value={p.call.tier_hit_rate !== null ? `${Math.round(p.call.tier_hit_rate * 100)}% right in backtests` : ''}
                />
                <CallRow
                  icon="shield-half-full"
                  color={t.brand}
                  title={`Safer call: ${p.call.safer.label}`}
                  value={`${Math.round(p.call.safer.probability * 100)}%${p.call.safer.hit_rate !== null ? ` · ${Math.round(p.call.safer.hit_rate * 100)}% right` : ''}`}
                />
                {p.call.draw_note ? <CallRow icon="equal" color={t.accent2} title={p.call.draw_note} value="" /> : null}
                {p.call.movement && m.prediction ? <Movement mv={p.call.movement} pick={m.prediction.pick} now={p.probabilities} home={m.home.short_name} away={m.away.short_name} /> : null}
                {p.goals ? (
                  <CallRow icon="soccer" color={t.pending} title={p.goals.over25 >= 0.5 ? 'Over 2.5 goals' : 'Under 2.5 goals'} value={`${Math.round(Math.max(p.goals.over25, 1 - p.goals.over25) * 100)}%`} />
                ) : null}
                {p.goals && p.goals.btts !== null ? (
                  <CallRow icon="swap-horizontal" color={t.pending} title={p.goals.btts >= 0.5 ? 'Both teams to score' : 'At least one side kept out'} value={`${Math.round(Math.max(p.goals.btts, 1 - p.goals.btts) * 100)}%`} />
                ) : null}
              </View>
            ) : null}
            {p.call && m.status === 'finished' && m.home_score !== null && m.away_score !== null ? <Review m={m} p={p} hs={m.home_score} as={m.away_score} /> : null}
            <SectionHeader title="Key factors" />
            <Row style={{ marginTop: -space.xs, marginBottom: space.sm, flexWrap: 'wrap' }} gap={space.md}>
              {(
                [
                  ['home', t.brand, m.home.short_name],
                  ['away', t.pending, m.away.short_name],
                ] as const
              ).map(([k, c, n]) => (
                <Row key={k} gap={4}>
                  <Icon name="arrow-up-bold" size={14} color={c} />
                  <Text v="tiny" muted>
                    favours {n}
                  </Text>
                </Row>
              ))}
            </Row>
            {p.key_factors.map((f, i) => (
              <Row key={i} style={{ alignItems: 'flex-start', marginBottom: space.sm }}>
                <Icon name={f.favours === 'neutral' ? 'circle-small' : 'arrow-up-bold'} size={18} color={f.favours === 'home' ? t.brand : f.favours === 'away' ? t.pending : t.textMuted} style={{ marginTop: 1 }} />
                <Text style={{ flex: 1 }}>{f.text}</Text>
              </Row>
            ))}
            {p.sources?.length ? <Sources p={p} home={m.home.short_name} away={m.away.short_name} hasDraws={m.has_draws} /> : null}
            <Explanation p={p} />
            <Text v="tiny" muted style={{ marginTop: space.md }}>
              {p.call?.source === 'model'
                ? `MK Sports model ${p.model_version} · prediction made ${relative(new Date(p.created_at).getTime())}`
                : p.call?.source === 'device'
                  ? `On-device estimate (this match is not in the published model's file) · updated ${relative(new Date(p.created_at).getTime())}`
                  : `${p.model} v${p.model_version} · updated ${relative(new Date(p.created_at).getTime())}`}
              {p.trigger === 'team_news' ? ' after team news' : ''}
            </Text>
          </Glass>
        </>
      ) : m.status === 'scheduled' ? (
        <Glass style={{ marginTop: space.md }}>
          <Text dim>Building the prediction from recent results… pull to refresh in a moment.</Text>
        </Glass>
      ) : null}

      {m.events.length ? (
        <>
          <SectionHeader title="Match events" icon="whistle" />
          <Glass>
            {m.events.map((e, i) => (
              <Row key={i} style={{ minHeight: 32, flexDirection: e.side === 'home' ? 'row' : 'row-reverse' }}>
                <Text v="mono" dim style={{ width: 52, textAlign: e.side === 'home' ? 'left' : 'right' }}>
                  {e.clock ?? `${e.minute}'`}
                </Text>
                <Icon name={e.type.endsWith('goal') ? 'soccer' : 'card'} size={16} color={e.type === 'red_card' ? t.live : e.type === 'yellow_card' ? '#FACC15' : t.text} />
                <Text v="small">
                  {e.player}
                  {e.type === 'own_goal' ? ' (og)' : e.type === 'penalty_goal' ? ' (pen)' : ''}
                </Text>
              </Row>
            ))}
          </Glass>
        </>
      ) : null}

      <SectionHeader title="Recent form" icon="chart-timeline-variant" />
      <Glass>
        <FormBlock team={m.home} games={m.form.home} />
        <View style={{ height: space.md }} />
        <FormBlock team={m.away} games={m.form.away} />
      </Glass>

      <SectionHeader title="Head to head" icon="sword-cross" />
      <Glass>
        {m.head_to_head.length ? (
          m.head_to_head.map((g) => (
            <Row key={g.match_id} style={{ minHeight: 36, justifyContent: 'space-between' }}>
              <Text v="small" dim>
                {new Date(g.date).toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' })}
              </Text>
              <Text v="small" style={{ fontWeight: '600' }}>
                {g.home ? `${m.home.short_name} ${g.score} ${g.opponent}` : `${g.opponent} ${g.score} ${m.home.short_name}`}
              </Text>
            </Row>
          ))
        ) : (
          <Text dim>No recent meetings on record.</Text>
        )}
      </Glass>

      <SectionHeader title="Team news" icon="medical-bag" />
      <Glass>
        {m.injuries_available === false ? (
          <Text v="small" dim>
            Our data source hasn't published team news for this match, so the prediction doesn't include injuries or suspensions.
          </Text>
        ) : (
          <>
            <Injuries name={m.home.short_name} list={m.injuries.home} />
            <View style={{ height: space.md }} />
            <Injuries name={m.away.short_name} list={m.injuries.away} />
          </>
        )}
      </Glass>

      {m.standings.length ? (
        <>
          <SectionHeader title="Standings" icon="table-large" action="Full table" onAction={() => router.push(`/league/${m.league.id}`)} />
          <Glass>
            <StandingsTable rows={m.standings} highlight={[m.home.id, m.away.id]} sport={m.sport} compact />
          </Glass>
        </>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ line-ups
function Lineups({ m, c, loading }: { m: MatchDetail; c: MatchCentre | undefined; loading: boolean }) {
  const t = useTheme();
  if (!c?.lineups) {
    return <EmptyState icon="tshirt-crew-outline" title={loading ? 'Loading line-ups…' : 'Line-ups not announced yet'} body={loading ? undefined : 'Teams usually publish them about an hour before kick-off.'} />;
  }
  const { home, away } = c.lineups;
  const [hc, ac] = kitColors(home.color ?? m.home.color, away.color ?? m.away.color);
  const open = (p: LineupPlayer) => p.id && router.push({ pathname: '/player/[id]', params: { id: p.id, league: m.league.id, match: m.id } });
  const bench = (l: typeof home, color: string, team: MatchDetail['home']) => (
    <Glass style={{ flex: 1 }} padded={false}>
      <Row gap={6} style={{ padding: space.md, paddingBottom: space.sm }}>
        <TeamBadge team={team} size={18} />
        <Text v="small" style={{ fontWeight: '800', flex: 1 }} numberOfLines={1}>
          {team.short_name}
        </Text>
      </Row>
      {l.bench.map((p, i) => (
        <Pressable key={p.id || p.name} onPress={() => open(p)} accessibilityRole="button" style={{ borderTopWidth: i ? 1 : 0, borderColor: t.glassBorder }}>
          <Row gap={8} style={{ paddingHorizontal: space.md, paddingVertical: 8 }}>
            <PlayerPhoto url={p.headshot} jersey={p.jersey} color={color} size={26} />
            <View style={{ flex: 1 }}>
              <Text v="small" style={{ fontWeight: p.subbedIn !== null ? '800' : '500' }} numberOfLines={1}>
                {p.short}
              </Text>
              {p.subbedIn !== null ? (
                <Row gap={3}>
                  <Icon name="arrow-up-bold" size={11} color={t.win} />
                  <Text v="tiny" color={t.win}>
                    {p.subbedIn || 'on'}
                  </Text>
                </Row>
              ) : null}
            </View>
            {p.goals ? <Icon name="soccer" size={13} color={t.text} /> : null}
            {p.yellow || p.red ? <View style={{ width: 8, height: 11, borderRadius: 2, backgroundColor: p.red ? '#EF4444' : '#FACC15' }} /> : null}
          </Row>
        </Pressable>
      ))}
    </Glass>
  );
  return (
    <View style={{ marginTop: space.md }}>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.sm }}>
        <Row gap={6}>
          <TeamBadge team={m.away} size={20} />
          <Text v="small" style={{ fontWeight: '800' }}>
            {m.away.short_name} · {away.formation ?? ''}
          </Text>
        </Row>
        {c.referee ? (
          <Row gap={4}>
            <Icon name="whistle" size={14} />
            <Text v="tiny" dim>
              {c.referee}
            </Text>
          </Row>
        ) : null}
      </Row>
      <Pitch home={home} away={away} homeColor={m.home.color} awayColor={m.away.color} onPlayer={open} />
      <Row gap={6} style={{ marginTop: space.sm }}>
        <TeamBadge team={m.home} size={20} />
        <Text v="small" style={{ fontWeight: '800' }}>
          {m.home.short_name} · {home.formation ?? ''}
        </Text>
      </Row>
      <Text v="tiny" muted style={{ marginTop: space.xs }}>
        Tap a player for this match, season stats and recent form.
      </Text>
      <SectionHeader title="Substitutes" icon="swap-vertical" />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {bench(home, hc, m.home)}
        {bench(away, ac, m.away)}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ live stats
function StatBar({ s, homeColor, awayColor }: { s: TeamStat; homeColor: string; awayColor: string }) {
  const t = useTheme();
  const h = Math.max(0, s.homeValue ?? 0);
  const a = Math.max(0, s.awayValue ?? 0);
  const tot = h + a || 1;
  const hLead = h > a;
  const aLead = a > h;
  return (
    <View style={{ marginBottom: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text v="mono" style={{ minWidth: 48 }} color={hLead ? t.text : t.textDim}>
          {s.home}
        </Text>
        <Text v="small" dim style={{ flex: 1, textAlign: 'center', fontWeight: '700' }}>
          {s.label}
        </Text>
        <Text v="mono" style={{ minWidth: 48, textAlign: 'right' }} color={aLead ? t.text : t.textDim}>
          {s.away}
        </Text>
      </Row>
      <View style={{ flexDirection: 'row', gap: 4, marginTop: 6 }}>
        <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: alpha(t.text, 0.08), alignItems: 'flex-end', overflow: 'hidden' }}>
          <View style={{ width: `${(100 * h) / tot}%`, height: 6, borderRadius: 3, backgroundColor: hLead ? homeColor : alpha(homeColor, 0.5) }} />
        </View>
        <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: alpha(t.text, 0.08), overflow: 'hidden' }}>
          <View style={{ width: `${(100 * a) / tot}%`, height: 6, borderRadius: 3, backgroundColor: aLead ? awayColor : alpha(awayColor, 0.5) }} />
        </View>
      </View>
      {s.note ? (
        <Text v="tiny" muted style={{ textAlign: 'center', marginTop: 3 }}>
          {s.note}
        </Text>
      ) : null}
    </View>
  );
}

function Stats({ m, c, loading }: { m: MatchDetail; c: MatchCentre | undefined; loading: boolean }) {
  const t = useTheme();
  if (!c?.stats.length) return <EmptyState icon="chart-bar" title={loading ? 'Loading match stats…' : m.status === 'scheduled' ? 'Stats appear at kick-off' : 'No match stats published'} />;
  const [hc, ac] = kitColors(m.home.color, m.away.color);
  const barColors = [t.mode === 'dark' && hc === '#111827' ? '#94A3B8' : hc, t.mode === 'dark' && ac === '#111827' ? '#94A3B8' : ac];
  return (
    <View style={{ marginTop: space.md }}>
      <Glass>
        <Row style={{ justifyContent: 'space-between', marginBottom: space.md }}>
          <Row gap={6}>
            <TeamBadge team={m.home} size={22} />
            <Text v="small" style={{ fontWeight: '800' }}>
              {m.home.code}
            </Text>
          </Row>
          <Text v="label" dim>
            Team stats
          </Text>
          <Row gap={6}>
            <Text v="small" style={{ fontWeight: '800' }}>
              {m.away.code}
            </Text>
            <TeamBadge team={m.away} size={22} />
          </Row>
        </Row>
        {c.stats.map((s) => (
          <StatBar key={s.key} s={s} homeColor={barColors[0]} awayColor={barColors[1]} />
        ))}
      </Glass>
      {c.xg && c.shots.length ? (
        <>
          <SectionHeader title="Shot map" icon="target" />
          <Glass>
            <ShotMap shots={c.shots} homeColor={barColors[0]} awayColor={barColors[1]} homeName={m.home.short_name} awayName={m.away.short_name} />
            <Text v="tiny" muted style={{ marginTop: space.sm }}>
              xG is MK Sports' own estimate from where each shot was taken, using a model fitted on {c.xg_model.shots.toLocaleString()} real shots from {c.xg_model.matches} matches. It is not an official provider's figure: the data doesn't say whether a shot was a header, so headers and kicks from the same spot get the same value.
            </Text>
          </Glass>
        </>
      ) : null}
      {c.performers.length ? (
        <>
          <SectionHeader title="Top performers" icon="account-star" />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {(['home', 'away'] as const).map((side) => (
              <Glass key={side} style={{ flex: 1 }} padded={false}>
                <Row gap={6} style={{ padding: space.md, paddingBottom: 4 }}>
                  <TeamBadge team={side === 'home' ? m.home : m.away} size={18} />
                  <Text v="small" style={{ fontWeight: '800' }}>
                    {(side === 'home' ? m.home : m.away).code}
                  </Text>
                </Row>
                {c.performers
                  .filter((p) => p.side === side)
                  .map((p, i) => (
                    <Pressable key={`${p.category}-${i}`} disabled={!p.id} onPress={() => p.id && router.push({ pathname: '/player/[id]', params: { id: p.id, league: m.league.id } })} style={{ paddingHorizontal: space.md, paddingVertical: 8 }}>
                      <Text v="tiny" muted>
                        {p.category}
                      </Text>
                      <Text v="small" style={{ fontWeight: '700' }} numberOfLines={1}>
                        {p.player}
                      </Text>
                      <Text v="tiny" dim numberOfLines={2}>
                        {p.value}
                      </Text>
                    </Pressable>
                  ))}
              </Glass>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ timeline
const TL_ICON: Record<string, [string, string | null]> = {
  goal: ['soccer', null],
  own_goal: ['soccer', '#F87171'],
  penalty_goal: ['soccer', null],
  penalty_miss: ['close-circle-outline', '#F87171'],
  yellow_card: ['card', '#FACC15'],
  red_card: ['card', '#EF4444'],
  sub: ['swap-vertical-bold', '#22C55E'],
  var: ['monitor-eye', null],
  period: ['whistle', null],
};

function Timeline({ m, c, loading }: { m: MatchDetail; c: MatchCentre | undefined; loading: boolean }) {
  const t = useTheme();
  if (!c || (!c.timeline.length && !c.commentary.length)) return <EmptyState icon="timeline-clock-outline" title={loading ? 'Loading timeline…' : m.status === 'scheduled' ? 'Timeline starts at kick-off' : 'No timeline published'} />;
  const items = [...c.timeline].reverse();
  return (
    <View style={{ marginTop: space.md }}>
      {items.length ? (
        <Glass>
          {items.map((e: TimelineItem, i) => {
            const [icon, color] = TL_ICON[e.type] ?? ['circle-small', null];
            if (e.type === 'period') {
              return (
                <View key={i} style={{ alignItems: 'center', paddingVertical: 8 }}>
                  <Text v="tiny" muted style={{ fontWeight: '800' }}>
                    {e.text.split('.')[0]}
                  </Text>
                </View>
              );
            }
            const right = e.side === 'away';
            return (
              <Row key={i} style={{ minHeight: 44, flexDirection: right ? 'row-reverse' : 'row' }} gap={10}>
                <Text v="mono" dim style={{ width: 52, textAlign: right ? 'right' : 'left' }}>
                  {e.minute}
                </Text>
                <Icon name={icon} size={18} color={color ?? t.text} />
                <View style={{ flex: 1, alignItems: right ? 'flex-end' : 'flex-start' }}>
                  <Text v="small" style={{ fontWeight: '700' }}>
                    {e.player}
                    {e.type === 'own_goal' ? ' (og)' : e.type === 'penalty_goal' ? ' (pen)' : e.type === 'penalty_miss' ? ' (pen missed)' : ''}
                  </Text>
                  {e.detail ? (
                    <Text v="tiny" muted>
                      {e.detail}
                    </Text>
                  ) : null}
                </View>
              </Row>
            );
          })}
        </Glass>
      ) : null}
      {c.commentary.length ? (
        <>
          <SectionHeader title="Commentary" icon="message-text-outline" />
          <Glass>
            {c.commentary.map((x, i) => (
              <Row key={i} style={{ alignItems: 'flex-start', paddingVertical: 6 }} gap={10}>
                <Text v="tiny" muted style={{ width: 40, fontWeight: '800' }}>
                  {x.minute}
                </Text>
                <Text v="small" style={{ flex: 1 }}>
                  {x.text}
                </Text>
              </Row>
            ))}
          </Glass>
        </>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ pieces kept from the prediction view
function PickCta({ m }: { m: MatchDetail }) {
  const t = useTheme();
  const now = useNow(m.status === 'scheduled' ? 1000 : 0);
  const p = m.my_pick;
  const locksIn = new Date(m.start_time).getTime() - now;
  const locked = m.locked || locksIn <= 0;
  const pickText = p ? `${outcomeLabel(p.pick, m.home.short_name, m.away.short_name)}${p.home_score !== null ? ` ${p.home_score}-${p.away_score}` : ''}` : null;
  if (!m.prediction_full && !p && locked) return null;
  if (!locked && !p) {
    return (
      <PressableScale onPress={() => router.push(`/pick/${m.id}`)} accessibilityLabel="Make your pick" scaleTo={0.97} feedback="thud" style={{ marginTop: space.md }}>
        <LinearGradient colors={[t.brand, t.accent2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', right: -24, top: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.16)' }} />
          <View style={{ flex: 1 }}>
            <Text v="hero" color="#04120B" style={{ fontSize: 38, lineHeight: 40 }}>
              CALL IT
            </Text>
            <Text v="small" color="rgba(4,18,11,0.85)" style={{ fontWeight: '700' }}>
              Pick the result before kick-off · {relative(new Date(m.start_time).getTime(), now).replace('in ', '')} left
            </Text>
          </View>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#04120B', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="hand-pointing-right" size={26} color={t.brand} />
          </View>
        </LinearGradient>
      </PressableScale>
    );
  }
  return (
    <Glass style={{ marginTop: space.md }}>
      {p ? (
        <Row style={{ justifyContent: 'space-between', marginBottom: locked ? 0 : space.md }}>
          <View>
            <Text v="tiny" muted>
              Your pick
            </Text>
            <Text v="h3">{pickText}</Text>
          </View>
          <Text v="h3" color={p.status === 'won' ? t.win : p.status === 'lost' ? t.loss : t.textDim}>
            {p.status === 'pending' ? (locked ? 'Locked' : 'Pending') : p.status === 'void' ? 'Void' : `${p.points} pts`}
          </Text>
        </Row>
      ) : null}
      {!locked ? (
        <>
          <Button title={p ? 'Change pick' : 'Make your pick'} icon="hand-pointing-right" onPress={() => router.push(`/pick/${m.id}`)} />
          <Text v="tiny" muted style={{ marginTop: space.sm, textAlign: 'center' }}>
            Locks at kick-off · {relative(new Date(m.start_time).getTime(), now).replace('in ', '')} left · {rulesText(m.scoring, m.has_draws)}
          </Text>
        </>
      ) : !p ? (
        <Row>
          <Icon name="lock-outline" />
          <Text dim>Picks locked at kick-off.</Text>
        </Row>
      ) : null}
    </Glass>
  );
}

function Explanation({ p }: { p: NonNullable<MatchDetail['prediction_full']> }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginTop: space.sm }}>
      <Pressable onPress={() => setOpen(!open)} style={{ minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: space.sm }} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} color={t.brand} />
        <Text color={t.brand} style={{ fontWeight: '700' }}>
          How this prediction was made
        </Text>
      </Pressable>
      {open ? (
        <View style={{ gap: space.md, borderLeftWidth: 2, borderColor: t.glassBorder, paddingLeft: space.md }}>
          <Text v="small" dim>
            Method: {p.explanation.method}. Explainable statistics, not a black box; the same model is backtested on past results.
          </Text>
          {p.explanation.steps.map((s, i) => (
            <View key={i}>
              <Text v="small" style={{ fontWeight: '700' }}>
                {i + 1}. {s.title}
              </Text>
              <Text v="small" dim>
                {s.detail}
              </Text>
            </View>
          ))}
          <Pressable onPress={() => router.push('/accuracy')} style={{ minHeight: TAP, justifyContent: 'center' }}>
            <Text v="small" color={t.brand} style={{ fontWeight: '700' }}>
              See how accurate the model has been →
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function FormBlock({ team, games }: { team: MatchDetail['home']; games: FormGame[] }) {
  return (
    <View>
      <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <Row gap={6}>
          <TeamBadge team={team} size={20} />
          <Text style={{ fontWeight: '700' }}>{team.short_name}</Text>
        </Row>
        <FormPills results={games.map((g) => g.result).join('')} />
      </Row>
      {games.slice(0, 5).map((g) => (
        <Row key={g.match_id} style={{ minHeight: 28 }}>
          <Text v="small" muted style={{ width: 22 }}>
            {g.home ? 'H' : 'A'}
          </Text>
          <Text v="small" style={{ flex: 1 }} numberOfLines={1}>
            {g.opponent}
          </Text>
          <Text v="small" dim>
            {g.score}
          </Text>
        </Row>
      ))}
      {!games.length ? <Text dim>No results yet.</Text> : null}
    </View>
  );
}

function Injuries({ name, list }: { name: string; list: Injury[] }) {
  const t = useTheme();
  return (
    <View>
      <Text style={{ fontWeight: '700', marginBottom: 4 }}>{name}</Text>
      {list.length ? (
        list.map((i) => (
          <Row key={i.player} style={{ minHeight: 28 }}>
            <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: i.status === 'doubtful' ? t.pending : t.live }} />
            <Text v="small" style={{ flex: 1 }}>
              {i.player} <Text v="small" muted>{i.position}</Text>
            </Text>
            <Text v="tiny" dim>
              {i.detail ?? i.status}
            </Text>
          </Row>
        ))
      ) : (
        <Text v="small" dim>
          No reported absences.
        </Text>
      )}
    </View>
  );
}

function Sources({ p, home, away, hasDraws }: { p: NonNullable<MatchDetail['prediction_full']>; home: string; away: string; hasDraws: boolean }) {
  const t = useTheme();
  const list = [...(p.sources ?? [])].sort((a, b) => b.weight - a.weight);
  return (
    <View style={{ marginTop: space.sm }}>
      <SectionHeader title={`Sources · ${list.length}`} />
      {list.map((s) => {
        const pr = s.probs;
        const fav = (['home', 'draw', 'away'] as const).reduce((b, k) => ((pr[k] ?? -1) > (pr[b] ?? -1) ? k : b), 'home');
        return (
          <View key={s.source} style={{ marginBottom: space.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text v="small" style={{ fontWeight: '700' }}>
                {s.label}
              </Text>
              <Text v="tiny" muted>
                weight {Math.round(s.weight * 100)}%
              </Text>
            </Row>
            <Text v="tiny" dim>
              {home} {Math.round((pr.home ?? 0) * 100)}%{hasDraws ? ` · draw ${Math.round((pr.draw ?? 0) * 100)}%` : ''} · {away} {Math.round((pr.away ?? 0) * 100)}% · favours {fav === 'home' ? home : fav === 'away' ? away : 'a draw'}
            </Text>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: alpha(t.text, 0.08), marginTop: 4, overflow: 'hidden' }}>
              <View style={{ width: `${Math.round(s.weight * 100)}%`, height: '100%', backgroundColor: t.brand }} />
            </View>
          </View>
        );
      })}
      <Text v="tiny" muted>
        Weights favour the sources with the better track record on the same past matches.
      </Text>
    </View>
  );
}
