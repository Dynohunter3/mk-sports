/**
 * Predictions: every upcoming football match for the next 7 days with the model's call (home, draw or
 * away), how strong it is, and the safer call. Filters pick out draw calls, strong calls and the safest
 * double chances. Each figure quoted here was measured on past seasons (see the Accuracy screen).
 */
import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, View } from 'react-native';

import { useApi } from '@/api/cache';
import type { GradedCall, MatchCard, PredictionsList, RecordWindow } from '@/api/types';
import { Glass } from '@/components/glass';
import { CallBadge, ProbabilityBar, TeamBadge, TierPill } from '@/components/match';
import { Chip, ChipRow, Disclaimer, EmptyState, Icon, Loading, Row, SectionHeader, Segmented, StatusBanner, Text } from '@/components/ui';
import { dayLabel, kickoffTime, pct, relative } from '@/lib/format';
import { space, useTheme } from '@/theme/theme';

type Filter = 'all' | 'draws' | 'strong' | 'safer' | 'results';
type Item = MatchCard | GradedCall;
const isResult = (x: Item): x is GradedCall => 'score' in x && 'correct' in x;

const PredictionRow = memo(function PredictionRow({ m, showLeague }: { m: MatchCard; showLeague: boolean }) {
  const t = useTheme();
  const p = m.prediction!;
  return (
    <Pressable onPress={m.offline ? undefined : () => router.push(`/match/${m.id}`)} disabled={m.offline} accessibilityRole="button" accessibilityLabel={`${m.home.short_name} against ${m.away.short_name}`} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <Glass style={{ marginBottom: space.sm }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <Text v="tiny" muted style={{ fontWeight: '700' }}>
            {kickoffTime(m.start_time)}
            {showLeague ? ` · ${m.league.short_name}` : ''}
          </Text>
          {p.tier ? <TierPill tier={p.tier} /> : null}
        </Row>
        {(['home', 'away'] as const).map((side) => (
          <Row key={side} gap={space.sm} style={{ minHeight: 30 }}>
            <TeamBadge team={m[side]} size={24} />
            <Text style={{ flex: 1, fontWeight: p.pick === side ? '800' : '500' }} numberOfLines={1}>
              {m[side].short_name}
            </Text>
            <Text v="small" dim>
              {pct(p[side])}
            </Text>
          </Row>
        ))}
        <View style={{ marginTop: 6 }}>
          <ProbabilityBar p={p} home={m.home.code} away={m.away.code} height={5} showLabels={false} />
        </View>
        <Row style={{ justifyContent: 'space-between', marginTop: space.sm }} gap={space.sm}>
          <CallBadge p={p} home={m.home.short_name} away={m.away.short_name} />
          {p.safer ? (
            <Row gap={4} style={{ flexShrink: 1 }}>
              <Icon name="shield-half-full" size={14} color={t.textMuted} />
              <Text v="tiny" dim numberOfLines={1} style={{ flexShrink: 1 }}>
                {p.safer} {pct(p.safer_p)}
              </Text>
            </Row>
          ) : null}
        </Row>
      </Glass>
    </Pressable>
  );
});

const OUTCOME_NAME = (o: 'home' | 'draw' | 'away', h: string, a: string) => (o === 'home' ? h : o === 'away' ? a : 'Draw');
const LEAGUE_NAME: Record<string, string> = {
  'eng.1': 'Premier League', 'eng.2': 'Championship', 'esp.1': 'LaLiga', 'ita.1': 'Serie A', 'ger.1': 'Bundesliga', 'fra.1': 'Ligue 1',
  'ned.1': 'Eredivisie', 'por.1': 'Liga Portugal', 'tur.1': 'Süper Lig', 'usa.1': 'MLS', 'uefa.champions': 'Champions League',
};

/** A finished match: the call made before kick-off and whether it was right. */
const ResultRow = memo(function ResultRow({ r }: { r: GradedCall }) {
  const t = useTheme();
  const ok = r.correct === 1;
  return (
    <Glass style={{ marginBottom: space.sm }}>
      <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <Text v="tiny" muted style={{ fontWeight: '700' }}>
          {kickoffTime(r.kickoff)} · {LEAGUE_NAME[r.competition] ?? r.competition}
        </Text>
        {r.tier ? <TierPill tier={r.tier} /> : null}
      </Row>
      <Text style={{ fontWeight: '800' }} numberOfLines={1}>
        {r.home} {r.score} {r.away}
      </Text>
      <Row style={{ justifyContent: 'space-between', marginTop: 6 }} gap={space.sm}>
        <Row gap={6} style={{ flexShrink: 1 }}>
          <Icon name={ok ? 'check-circle' : 'close-circle'} size={18} color={ok ? t.win : t.loss} />
          <Text v="small" style={{ fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
            {OUTCOME_NAME(r.pick, r.home, r.away)} · {pct(r.probability)}
          </Text>
        </Row>
        {r.safer_call ? (
          <Row gap={4} style={{ flexShrink: 1 }}>
            <Icon name="shield-half-full" size={14} color={r.safer_correct ? t.win : t.loss} />
            <Text v="tiny" dim numberOfLines={1} style={{ flexShrink: 1 }}>
              {r.safer_call === 'home or away' ? `${r.home} or ${r.away} (no draw)` : r.safer_call === 'home or draw' ? `${r.home} or draw` : `${r.away} or draw`}{' '}
              {r.safer_correct ? '✓' : '✗'}
            </Text>
          </Row>
        ) : null}
      </Row>
    </Glass>
  );
});

function windowText(label: string, w: RecordWindow | null | undefined) {
  if (!w || !w.matches.n) return null;
  const strong = w.strong.n ? ` · strong calls ${Math.round((w.strong.hit_rate ?? 0) * 100)}% (${w.strong.n})` : '';
  return `${label}: ${Math.round((w.matches.hit_rate ?? 0) * 100)}% right (${w.matches.n} matches) · safer calls ${Math.round((w.safer_call.hit_rate ?? 0) * 100)}%${strong}`;
}

export default function PredictionsScreen() {
  const t = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const [league, setLeague] = useState<string | null>(null);
  const res = useApi<PredictionsList>('/predictions?days=7', { maxAge: 120 });
  const d = res.data;

  const sections = useMemo((): { key: string; title: string; data: Item[] }[] => {
    if (filter === 'results') {
      const byDay = new Map<string, GradedCall[]>();
      for (const r of (d?.results?.items ?? []).filter((x) => !league || x.competition === league)) {
        const k = dayLabel(new Date(r.kickoff)) + ' · ' + new Date(r.kickoff).toLocaleDateString([], { day: 'numeric', month: 'short' });
        byDay.set(k, [...(byDay.get(k) ?? []), r]);
      }
      return [...byDay.entries()].map(([k, v]) => ({ key: `r:${k}`, title: k, data: v }));
    }
    const items = (d?.items ?? []).filter((m) => !league || m.league.id === league);
    if (filter === 'draws') {
      const calls = items.filter((m) => m.prediction?.pick === 'draw');
      const possible = items.filter((m) => m.prediction?.pick !== 'draw' && m.prediction?.draw_note);
      return [
        ...(calls.length ? [{ key: 'calls', title: `Draw calls (${calls.length})`, data: calls }] : []),
        ...(possible.length ? [{ key: 'possible', title: `A draw is a real possibility (${possible.length})`, data: possible }] : []),
      ];
    }
    const keep = items.filter((m) => (filter === 'strong' ? m.prediction?.tier === 'strong' : filter === 'safer' ? (m.prediction?.safer_p ?? 0) >= 0.85 : true));
    const byDay = new Map<string, MatchCard[]>();
    for (const m of keep) {
      const k = dayLabel(new Date(m.start_time)) + ' · ' + new Date(m.start_time).toLocaleDateString([], { day: 'numeric', month: 'short' });
      byDay.set(k, [...(byDay.get(k) ?? []), m]);
    }
    return [...byDay.entries()].map(([k, v]) => ({ key: k, title: k, data: v }));
  }, [d, filter, league]);

  const n = (f: (m: MatchCard) => boolean) => (d?.items ?? []).filter((m) => (!league || m.league.id === league) && f(m)).length;
  const counts = {
    all: n(() => true),
    draws: n((m) => m.prediction?.pick === 'draw' || !!m.prediction?.draw_note),
    strong: n((m) => m.prediction?.tier === 'strong'),
    safer: n((m) => (m.prediction?.safer_p ?? 0) >= 0.85),
    results: (d?.results?.items ?? []).filter((x) => !league || x.competition === league).length,
  };
  const rec = d?.results?.record;
  const tr = d?.track.model;

  const explainer =
    filter === 'results'
      ? [windowText('Last 7 days', rec?.last_7_days), (rec?.last_30_days?.matches.n ?? 0) > (rec?.last_7_days?.matches.n ?? 0) ? windowText('Last 30 days', rec?.last_30_days) : null]
          .filter(Boolean)
          .join('\n') ||
        'Results appear here as matches finish. Each match is graded on the last prediction made before kick-off, wins and misses alike.'
      : filter === 'draws'
      ? tr
        ? `Draw calls were right ${pct(tr.draw_calls)} of the time in backtests; draws happen in ${pct(tr.draw_base_rate)} of matches. Where the draw is close but not called, ${pct(tr.draw_note)} of matches ended level. Draws are the hardest result to call: no model gets most of them.`
        : 'Draw calls come from the published model.'
      : filter === 'strong'
        ? `The model's strongest band (65%+ for the pick): right ${pct(tr?.tiers.strong ?? d?.track.device.tiers.strong)} of the time in backtests.`
        : filter === 'safer'
          ? `Safer calls (two of the three results) rated 85% or more were right ${pct(tr?.safer_strong ?? 0.9)} of the time in backtests.`
          : `Each call is a win or a draw. Strength shows how often calls like it were right in backtests: Strong ${pct(tr?.tiers.strong ?? d?.track.device.tiers.strong)}, Likely ${pct(tr?.tiers.likely ?? d?.track.device.tiers.likely)}, Lean ${pct(tr?.tiers.lean ?? d?.track.device.tiers.lean)}.`;

  const header = (
    <View>
      <Text dim>Every football match in the next 7 days with the model&apos;s call: home win, draw or away win.</Text>
      {d?.model ? (
        <Text v="tiny" muted style={{ marginTop: 4 }}>
          MK Sports model {d.model.version} · predictions published {relative(Date.parse(d.model.generated_at))}
          {d.model.source === 'bundled' ? ' (built into the app; newer ones download when published)' : ''}
        </Text>
      ) : d ? (
        <Text v="tiny" muted style={{ marginTop: 4 }}>
          On-device estimates (the published predictions have not reached this device yet)
        </Text>
      ) : null}
      {d?.offline ? (
        <Glass style={{ marginTop: space.sm }}>
          <Row gap={space.sm}>
            <Icon name="wifi-off" size={18} color={t.pending} />
            <Text v="small" dim style={{ flex: 1 }}>
              {d.slow
                ? 'Live fixtures are slow to load, so these are the published predictions. Pull down to refresh in a moment; match pages open once fixtures load.'
                : "Can't load live fixtures, so these are the saved predictions. Kick-off times may have changed; match pages open when you're back online."}
            </Text>
          </Row>
        </Glass>
      ) : null}
      <View style={{ marginTop: space.md }}>
        <Segmented
          scroll
          options={[
            { value: 'all', label: `All ${counts.all}` },
            { value: 'draws', label: `Draws ${counts.draws}` },
            { value: 'strong', label: `Strong ${counts.strong}` },
            { value: 'safer', label: `Safer 85%+ ${counts.safer}` },
            { value: 'results', label: `Results ${counts.results}` },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>
      {d?.leagues.length ? (
        <View style={{ marginTop: space.sm }}>
          <ChipRow>
            <Chip label="All leagues" selected={!league} onPress={() => setLeague(null)} />
            {d.leagues.map((l) => (
              <Chip key={l.slug} label={l.short_name} badge={String(l.n)} selected={league === l.slug} onPress={() => setLeague(league === l.slug ? null : l.slug)} />
            ))}
          </ChipRow>
        </View>
      ) : null}
      <Glass style={{ marginTop: space.sm }}>
        <Row style={{ alignItems: 'flex-start' }} gap={space.sm}>
          <Icon name={filter === 'draws' ? 'equal' : filter === 'results' ? 'history' : 'information-outline'} size={18} color={filter === 'draws' ? t.accent2 : filter === 'results' ? t.brand : t.textMuted} style={{ marginTop: 1 }} />
          <Text v="small" dim style={{ flex: 1 }}>
            {explainer}
          </Text>
        </Row>
      </Glass>
      <StatusBanner error={res.error} offline={res.offline} updatedAt={res.updatedAt} onRetry={res.refresh} />
    </View>
  );

  if (res.loading && !d) return <Loading label="Loading predictions…" />;
  return (
    <SectionList<Item, { key: string; title: string; data: Item[] }>
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}
      sections={sections}
      keyExtractor={(m) => (isResult(m) ? `r:${m.match_id}` : m.id)}
      renderItem={({ item }) => (isResult(item) ? <ResultRow r={item} /> : <PredictionRow m={item} showLeague={!league} />)}
      renderSectionHeader={({ section }) => (
        <SectionHeader
          title={section.title}
          icon={section.key === 'calls' ? 'equal' : section.key === 'possible' ? 'approximately-equal' : section.key.startsWith('r:') ? 'history' : 'calendar'}
          color={section.key === 'calls' ? t.accent2 : undefined}
        />
      )}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      ListEmptyComponent={
        res.error && !d ? (
          <EmptyState icon="wifi-off" title="Can't load predictions" body={res.error} action="Try again" onAction={res.refresh} />
        ) : (
          <EmptyState
            icon="crystal-ball"
            title={filter === 'results' ? 'No graded matches yet' : filter === 'draws' ? 'No draws called this week' : filter === 'strong' ? 'No strong calls this week' : filter === 'safer' ? 'No safer calls at 85%+ this week' : 'No upcoming matches'}
            body={
              filter === 'draws'
                ? 'Draw calls are rarest before a match\'s odds are out; they appear when the odds arrive (Tuesdays and Fridays). Matches where a draw is close are listed here too.'
                : filter === 'results'
                  ? 'Matches are graded a day or two after full time, once the results source publishes them.'
                  : undefined
            }
          />
        )
      }
      ListFooterComponent={
        <View style={{ marginTop: space.md }}>
          {d?.unavailable.length ? (
            <Text v="tiny" muted>
              Temporarily unavailable from the data source: {d.unavailable.join(', ')}
            </Text>
          ) : null}
          <Disclaimer compact />
        </View>
      }
      refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} tintColor={t.brand} />}
    />
  );
}
