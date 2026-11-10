import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { useApi } from '@/api/cache';
import type { Accuracy, AccuracyRow } from '@/api/types';
import { Card, Disclaimer, EmptyState, Icon, Loading, Row, SectionHeader, Segmented, StatTile, StatusBanner, Text } from '@/components/ui';
import { pct } from '@/lib/format';
import { radius, space, SPORT_COLORS, useTheme } from '@/theme/theme';

type Source = 'all' | 'live' | 'backtest';

function Bar({ value, color }: { value: number | null; color: string }) {
  const t = useTheme();
  return (
    <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: t.surface2, overflow: 'hidden', flex: 1 }}>
      <View style={{ width: `${Math.round((value ?? 0) * 100)}%`, height: '100%', backgroundColor: color }} />
    </View>
  );
}

function SportCard({ r }: { r: AccuracyRow }) {
  const t = useTheme();
  const color = SPORT_COLORS[r.sport] ?? t.brand;
  return (
    <Card style={{ marginBottom: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text v="h3">{r.name}</Text>
        <Text v="h2" color={color}>
          {pct(r.hit_rate)}
        </Text>
      </Row>
      <Text v="tiny" muted>
        {r.correct} of {r.n} predictions correct · Brier {r.brier?.toFixed(3)} · log loss {r.log_loss?.toFixed(3)}
      </Text>
      <Text v="label" dim style={{ marginTop: space.md, marginBottom: 6 }}>
        By confidence
      </Text>
      {(['high', 'medium', 'low'] as const).map((c) => {
        const b = r.by_confidence[c];
        if (!b) return null;
        return (
          <Row key={c} style={{ minHeight: 28 }}>
            <Text v="small" style={{ width: 64, textTransform: 'capitalize' }}>
              {c}
            </Text>
            <Bar value={b.hit_rate} color={c === 'high' ? t.win : c === 'medium' ? t.pending : t.draw} />
            <Text v="small" style={{ width: 92, textAlign: 'right' }} dim>
              {pct(b.hit_rate)} ({b.n})
            </Text>
          </Row>
        );
      })}
    </Card>
  );
}

export default function AccuracyScreen() {
  const t = useTheme();
  const [source, setSource] = useState<Source>('all');
  const acc = useApi<Accuracy>(`/accuracy?source=${source}`, { maxAge: 300 });
  const d = acc.data;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }} refreshControl={<RefreshControl refreshing={acc.refreshing} onRefresh={acc.refresh} tintColor={t.brand} />}>
      <Text dim>Every prediction is scored automatically once the final whistle blows. Nothing is hidden: misses count too.</Text>
      <View style={{ marginVertical: space.md }}>
        <Segmented
          options={[
            { value: 'all', label: 'All' },
            { value: 'live', label: 'Published live' },
            { value: 'backtest', label: 'Backtest' },
          ]}
          value={source}
          onChange={setSource}
        />
      </View>
      <StatusBanner error={acc.error} offline={acc.offline} updatedAt={acc.updatedAt} onRetry={acc.refresh} />
      {acc.loading ? (
        <Loading />
      ) : !d || d.overall.n === 0 ? (
        <EmptyState icon="chart-bell-curve" title="No scored predictions yet" body="Accuracy appears as soon as predicted matches finish." />
      ) : (
        <>
          <Row>
            <StatTile label="Hit rate" value={pct(d.overall.hit_rate)} color={t.brand} sub={`${d.overall.n} matches`} />
            <StatTile label="Brier score" value={d.overall.brier?.toFixed(3) ?? '–'} sub="lower is better" />
            <StatTile label="Log loss" value={d.overall.log_loss?.toFixed(3) ?? '–'} sub="lower is better" />
          </Row>
          {source !== 'live' ? (
            <Text v="tiny" muted style={{ marginTop: space.sm }}>
              Backtest = every match of the last 12 months predicted only from results before it (MK Sports model and market consensus). Live = forecasts saved on this phone before kick-off.
            </Text>
          ) : null}
          {d.by_source?.length ? (
            <>
              <SectionHeader title="By source" />
              <Card>
                <Row style={{ minHeight: 28 }}>
                  <Text v="tiny" muted style={{ flex: 1 }}>
                    Source
                  </Text>
                  <Text v="tiny" muted style={{ width: 52, textAlign: 'right' }}>
                    Matches
                  </Text>
                  <Text v="tiny" muted style={{ width: 48, textAlign: 'right' }}>
                    Hit
                  </Text>
                  <Text v="tiny" muted style={{ width: 56, textAlign: 'right' }}>
                    Log loss
                  </Text>
                </Row>
                {[...d.by_source]
                  .sort((a, b) => (a.kind === b.kind ? a.log_loss - b.log_loss : a.kind.localeCompare(b.kind)))
                  .map((r) => (
                    <Row key={`${r.source}-${r.kind}`} style={{ minHeight: 36 }}>
                      <Text v="small" style={{ flex: 1 }} numberOfLines={1}>
                        {r.label} <Text v="tiny" muted>{r.kind === 'live' ? 'live' : 'backtest'}</Text>
                      </Text>
                      <Text v="small" dim style={{ width: 52, textAlign: 'right' }}>
                        {r.n}
                      </Text>
                      <Text v="small" style={{ width: 48, textAlign: 'right' }}>
                        {pct(r.hit_rate)}
                      </Text>
                      <Text v="small" dim style={{ width: 56, textAlign: 'right' }}>
                        {r.log_loss.toFixed(3)}
                      </Text>
                    </Row>
                  ))}
                <Text v="tiny" muted style={{ marginTop: space.sm }}>
                  Lower log loss = better probabilities. Forecasts are blended with weights that favour the sources with the lower log loss on the same matches.
                </Text>
              </Card>
            </>
          ) : null}
          <SectionHeader title="By sport" />
          {d.sports.map((r) => (
            <SportCard key={r.key} r={r} />
          ))}
          <SectionHeader title="By competition" />
          <Card>
            {d.leagues.map((r) => (
              <Row key={r.key} style={{ minHeight: 40 }}>
                <Text v="small" style={{ width: 130 }} numberOfLines={1}>
                  {r.name}
                </Text>
                <Bar value={r.hit_rate} color={SPORT_COLORS[r.sport] ?? t.brand} />
                <Text v="small" dim style={{ width: 84, textAlign: 'right' }}>
                  {pct(r.hit_rate)} ({r.n})
                </Text>
              </Row>
            ))}
          </Card>
          {source !== 'live' && d.football_track ? (
            <>
              <SectionHeader title="Football: how often each call is right" />
              <Card>
                {(
                  [
                    ['Strong calls', d.football_track.tiers.strong, t.win],
                    ['Likely', d.football_track.tiers.likely, t.brand],
                    ['Lean', d.football_track.tiers.lean, t.pending],
                    ['Toss-up', d.football_track.tiers['toss-up'], t.textMuted],
                  ] as const
                ).map(([label, r, color]) =>
                  r ? (
                    <Row key={label} style={{ minHeight: 34 }}>
                      <Text v="small" style={{ width: 96 }}>
                        {label}
                      </Text>
                      <Bar value={r.hit_rate} color={color} />
                      <Text v="small" dim style={{ width: 118, textAlign: 'right' }}>
                        {pct(r.hit_rate)} · {pct(r.share)} of games
                      </Text>
                    </Row>
                  ) : null,
                )}
                <View style={{ height: 1, backgroundColor: t.surface2, marginVertical: space.sm }} />
                {(
                  [
                    ['All matches', d.football_track.all_matches.hit_rate, `bookmakers ${pct(d.football_track.bookmaker.hit_rate)}`],
                    ['Draw calls', d.football_track.draw_calls.hit_rate, `${pct(d.football_track.draw_calls.share)} of games · ${pct(d.football_track.draw_calls.base_rate)} of all games are draws`],
                    ['Safer call (two outcomes)', d.football_track.double_chance.hit_rate, `strongest ${pct(d.football_track.double_chance.strong.share)}: ${pct(d.football_track.double_chance.strong.hit_rate)}`],
                    ...(d.football_track.over25 ? [['Over/under 2.5 goals', d.football_track.over25.hit_rate, `when 60%+ sure: ${pct(d.football_track.over25.confident.hit_rate)}`] as const] : []),
                    ...(d.football_track.btts ? [['Both teams to score', d.football_track.btts.hit_rate, `when 60%+ sure: ${pct(d.football_track.btts.confident.hit_rate)}`] as const] : []),
                  ] as const
                ).map(([label, v, sub]) => (
                  <View key={label} style={{ marginBottom: space.sm }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text v="small">{label}</Text>
                      <Text v="small" style={{ fontWeight: '700' }}>
                        {pct(v)}
                      </Text>
                    </Row>
                    <Text v="tiny" muted>
                      {sub}
                    </Text>
                  </View>
                ))}
                <Text v="tiny" muted style={{ marginTop: space.xs }}>
                  Measured on two full past seasons, each match predicted only from earlier data. Football has three outcomes and many upsets: across all matches even bookmakers call just over half correctly, so the app shows how strong each call is.
                </Text>
              </Card>
            </>
          ) : null}
          {source !== 'live' && d.football_backtest?.length ? (
            <>
              <SectionHeader title="Football: new model vs previous engine" />
              <Card>
                <Row style={{ minHeight: 28 }}>
                  <Text v="tiny" muted style={{ flex: 1 }}>
                    Log loss (lower is better)
                  </Text>
                  <Text v="tiny" muted style={{ width: 58, textAlign: 'right' }}>
                    Before
                  </Text>
                  <Text v="tiny" muted style={{ width: 58, textAlign: 'right' }}>
                    Now
                  </Text>
                  <Text v="tiny" muted style={{ width: 66, textAlign: 'right' }}>
                    Bookmaker
                  </Text>
                </Row>
                {d.football_backtest.map((r) => {
                  const better = r.previous_log_loss !== null && r.new_log_loss < r.previous_log_loss;
                  return (
                    <Row key={r.key} style={{ minHeight: 34 }}>
                      <Text v="small" style={{ flex: 1 }} numberOfLines={1}>
                        {r.name} <Text v="tiny" muted>{r.n}</Text>
                      </Text>
                      <Text v="small" dim style={{ width: 58, textAlign: 'right' }}>
                        {r.previous_log_loss?.toFixed(3) ?? '–'}
                      </Text>
                      <Text v="small" color={better ? t.win : t.loss} style={{ width: 58, textAlign: 'right' }}>
                        {r.new_log_loss.toFixed(3)}
                      </Text>
                      <Text v="small" dim style={{ width: 66, textAlign: 'right' }}>
                        {r.bookmaker_log_loss?.toFixed(3) ?? '–'}
                      </Text>
                    </Row>
                  );
                })}
                <Text v="tiny" muted style={{ marginTop: space.sm }}>
                  Same matches, two full seasons, every match predicted only from earlier data. Green = the new model is better than the previous engine there.
                </Text>
              </Card>
            </>
          ) : null}
          <SectionHeader title="Latest results vs prediction" />
          <Card>
            {d.recent.map((r) => (
              <Row key={r.match_id} style={{ minHeight: 40 }}>
                <Icon name={r.correct ? 'check-circle' : 'close-circle'} color={r.correct ? t.win : t.loss} />
                <Text v="small" style={{ flex: 1 }} numberOfLines={1}>
                  {r.home} {r.score} {r.away}
                </Text>
                <Text v="tiny" dim>
                  AI: {r.predicted === 'home' ? r.home : r.predicted === 'away' ? r.away : 'Draw'} {pct(r.probability)}
                </Text>
              </Row>
            ))}
          </Card>
          <Text v="small" dim style={{ marginTop: space.lg }}>
            {d.football_note ? `Football: ${d.football_note} ` : ''}
            {d.baseline_note}
          </Text>
        </>
      )}
      <Disclaimer />
    </ScrollView>
  );
}
