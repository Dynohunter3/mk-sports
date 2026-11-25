/**
 * Accuracy page: the live record against the tested range, and how good the probabilities are (RPS and a
 * calibration chart). Hit rate alone can't show either.
 */
import { View } from 'react-native';

import type { FootballQuality, RecordCheck } from '@/api/types';
import { alpha, space, useTheme } from '@/theme/theme';

import { Card, Row, SectionHeader, Text } from './ui';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The live hit rate as a dot on a scale, with the tested hit rate and the range chance allows around it. */
export function RecordBand({ r }: { r: RecordCheck }) {
  const t = useTheme();
  if (r.status === 'no_data' || r.expected === null || r.band === null || r.live === undefined) return null;
  const lo = 0.2;
  const hi = 0.8;
  const x = (v: number) => `${((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100}%` as const;
  const color = r.status === 'below' ? t.loss : r.status === 'above' ? t.win : r.status === 'within' ? t.brand : t.textDim;
  const label =
    r.status === 'too_few' ? `Too early to judge (${r.n} of ${r.min_n} matches)` : r.status === 'within' ? 'Within the tested range' : r.status === 'below' ? 'Below the tested range' : 'Above the tested range';
  return (
    <>
      <SectionHeader title="Football: live record vs testing" />
      <Card accessibilityLabel={`${label}. ${r.message}`}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontWeight: '800' }} color={color}>
            {label}
          </Text>
          <Text v="small" dim>
            {r.n} graded
          </Text>
        </Row>
        <View style={{ height: 34, marginTop: space.md, justifyContent: 'center' }}>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: alpha(t.text, 0.08) }} />
          {/* the range chance allows around the tested hit rate */}
          <View style={{ position: 'absolute', left: x(r.expected - r.band), right: undefined, width: `${((Math.min(hi, r.expected + r.band) - Math.max(lo, r.expected - r.band)) / (hi - lo)) * 100}%`, height: 14, borderRadius: 7, backgroundColor: alpha(t.brand, 0.25) }} />
          <View style={{ position: 'absolute', left: x(r.expected), width: 2, height: 22, marginLeft: -1, backgroundColor: t.brand }} />
          <View style={{ position: 'absolute', left: x(r.live), width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: color, borderWidth: 2, borderColor: t.bg }} />
        </View>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text v="tiny" muted>
            {pct(lo)}
          </Text>
          <Text v="tiny" muted>
            hit rate
          </Text>
          <Text v="tiny" muted>
            {pct(hi)}
          </Text>
        </Row>
        <Text v="small" dim style={{ marginTop: space.sm }}>
          Live {pct(r.live)} · tested {pct(r.expected)} · chance range {pct(Math.max(0, r.expected - r.band))}–{pct(Math.min(1, r.expected + r.band))}
        </Text>
        <Text v="tiny" muted style={{ marginTop: space.xs }}>
          {r.message} The shaded range is where 95% of live records would land by chance if the model is as good as in testing; it narrows as more matches are graded. From {r.min_n} matches, a record outside it is flagged here and in the data pipeline's health check.
        </Text>
      </Card>
    </>
  );
}

/** RPS against the bookmakers, and whether the model's percentages come true as often as they say. */
export function ProbabilityQuality({ q }: { q: FootballQuality }) {
  const t = useTheme();
  if (q.rps === null && !q.calibration.length) return null;
  return (
    <>
      <SectionHeader title="Football: how good are the probabilities?" />
      <Card>
        {q.rps !== null ? (
          <>
            <Text v="label">Ranked probability score (lower is better)</Text>
            {(
              [
                ['MK Sports model', q.model_rps_same_matches ?? q.rps, t.brand, `${q.backtest_n.toLocaleString()} backtested matches`],
                ...(q.bookmaker_rps !== null ? [['Bookmakers (closing odds)', q.bookmaker_rps, t.textDim, 'the same matches'] as const] : []),
                ...(q.live_rps !== null && q.live_n ? [['Live so far', q.live_rps, t.accent2, `${q.live_n} graded matches`] as const] : []),
              ] as const
            ).map(([label, v, c, sub]) => (
              <Row key={label} style={{ minHeight: 40, marginTop: 4 }} gap={space.sm}>
                <View style={{ flex: 1 }}>
                  <Text v="small" style={{ fontWeight: '700' }}>
                    {label}
                  </Text>
                  <Text v="tiny" muted>
                    {sub}
                  </Text>
                </View>
                <Text v="h2" style={{ fontSize: 20 }} color={c}>
                  {v.toFixed(3)}
                </Text>
              </Row>
            ))}
            <Text v="tiny" muted style={{ marginTop: space.xs }}>
              RPS is the standard score for home/draw/away forecasts. It rewards probability close to the result and treats the outcomes as ordered: calling a home win when it ends in a draw is less wrong than calling an away win. 0 would be perfect; always saying a third each scores about 0.23.
            </Text>
          </>
        ) : null}
        {q.calibration.length ? (
          <>
            <Text v="label" style={{ marginTop: space.lg }}>
              Do the percentages come true?
            </Text>
            <Text v="tiny" muted>
              Calls grouped by the chance the model gave them: the faint bar is what it said, the solid bar how often it happened.
            </Text>
            {q.calibration.map((b) => (
              <View key={b.lo} style={{ marginTop: space.sm }} accessible accessibilityLabel={`Calls given ${pct(b.lo)} to ${pct(b.hi)}: said ${pct(b.mean_p)}, happened ${pct(b.hit_rate)}, ${b.n} matches`}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text v="small">
                    Given {pct(b.lo)}–{pct(b.hi)}
                  </Text>
                  <Text v="small" style={{ fontWeight: '700' }}>
                    said {pct(b.mean_p)} · happened {pct(b.hit_rate)}
                  </Text>
                </Row>
                <View style={{ height: 12, marginTop: 4, borderRadius: 6, backgroundColor: alpha(t.text, 0.06), overflow: 'hidden' }}>
                  <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${b.mean_p * 100}%`, backgroundColor: alpha(t.brand, 0.3), borderRadius: 6 }} />
                  <View style={{ position: 'absolute', left: 0, top: 3, bottom: 3, width: `${b.hit_rate * 100}%`, backgroundColor: t.brand, borderRadius: 3 }} />
                </View>
                <Text v="tiny" muted>
                  {b.n.toLocaleString()} matches
                </Text>
              </View>
            ))}
            <Text v="tiny" muted style={{ marginTop: space.sm }}>
              Well calibrated means a 70% call wins about 70% of the time. Measured on two past seasons, each match predicted only from earlier data.
            </Text>
          </>
        ) : null}
      </Card>
    </>
  );
}
