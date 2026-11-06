/** Views for the leaders board and for tennis / Formula 1 / cricket, shared by Scores and Stats. */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Fragment, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { CricketMatch, F1Board, F1Standing, LeaderCategory, RankRow, TennisBoard, TennisMatch } from '@/api/types';
import { dayLabel, kickoffTime } from '@/lib/format';
import { alpha, space, useTheme } from '@/theme/theme';

import { PlayerPhoto } from './crest';
import { Glass } from './glass';
import { TeamBadge } from './match';
import { Chip, ChipRow, EmptyState, Icon, Row, Text } from './ui';

const Flag = ({ url, size = 16 }: { url: string | null; size?: number }) =>
  url ? <Image source={{ uri: url }} style={{ width: size * 1.4, height: size, borderRadius: 2 }} contentFit="cover" cachePolicy="disk" /> : <View style={{ width: size * 1.4 }} />;

// ------------------------------------------------------------------ leaders
export function LeadersView({ categories, league }: { categories: LeaderCategory[]; league: string }) {
  const t = useTheme();
  if (!categories.length) return <EmptyState icon="account-star-outline" title="No player stats yet" body="The data source hasn't published season leaders for this competition." />;
  return (
    <View style={{ gap: space.md }}>
      {categories.map((c) => (
        <Glass key={c.key} padded={false}>
          <Row style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, justifyContent: 'space-between' }}>
            <Text v="h3">{c.label}</Text>
            {c.team_stat ? (
              <Text v="tiny" muted>
                from this season's results
              </Text>
            ) : null}
          </Row>
          {c.rows.map((r, i) => {
            const body = (
              <Row gap={10} style={{ paddingHorizontal: space.lg, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: t.glassBorder }}>
                <Text v="small" style={{ width: 18, fontWeight: '800' }} color={i === 0 ? t.brand : t.textDim}>
                  {r.rank}
                </Text>
                {c.team_stat || !r.athlete_id ? (
                  r.team ? <TeamBadge team={r.team} size={30} /> : null
                ) : (
                  <PlayerPhoto url={r.headshot} jersey={r.position} color={r.team?.color ?? '#334155'} size={34} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: i === 0 ? '800' : '600' }} numberOfLines={1}>
                    {r.name}
                  </Text>
                  {!c.team_stat && r.team ? (
                    <Row gap={4}>
                      <TeamBadge team={r.team} size={14} />
                      <Text v="tiny" muted numberOfLines={1}>
                        {r.team.short_name}
                        {r.position ? ` · ${r.position}` : ''}
                      </Text>
                    </Row>
                  ) : null}
                </View>
                <Text v="mono" style={{ fontSize: i === 0 ? 18 : 15 }} color={i === 0 ? t.brand : t.text}>
                  {r.value}
                </Text>
              </Row>
            );
            return r.athlete_id ? (
              <Pressable key={`${c.key}-${r.rank}`} onPress={() => router.push({ pathname: '/player/[id]', params: { id: r.athlete_id!, league } })} accessibilityRole="button" accessibilityLabel={`${r.name}, ${r.value}`}>
                {body}
              </Pressable>
            ) : r.team ? (
              <Pressable key={`${c.key}-${r.rank}`} onPress={() => router.push({ pathname: '/team/[id]', params: { id: r.team!.id, league } })} accessibilityRole="button">
                {body}
              </Pressable>
            ) : (
              <Fragment key={`${c.key}-${r.rank}`}>{body}</Fragment>
            );
          })}
        </Glass>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ tennis
function TennisRow({ m }: { m: TennisMatch }) {
  const t = useTheme();
  const live = m.state === 'in';
  return (
    <Glass style={{ marginBottom: space.sm }} padded={false}>
      <View style={{ padding: space.md, gap: 6 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text v="tiny" muted numberOfLines={1} style={{ flex: 1 }}>
            {[m.round, m.court].filter(Boolean).join(' · ')}
          </Text>
          <Text v="tiny" color={live ? t.live : t.textDim} style={{ fontWeight: '800' }}>
            {live ? `LIVE ${m.status}` : m.state === 'pre' ? `${dayLabel(new Date(m.start))} ${kickoffTime(m.start)}` : m.status || 'Final'}
          </Text>
        </Row>
        {m.players.map((p, i) => (
          <Row key={i} gap={8}>
            <Flag url={p.flag} />
            <Text style={{ flex: 1, fontWeight: p.winner ? '800' : '500' }} numberOfLines={1}>
              {p.name}
              {p.seed ? <Text v="tiny" muted>{`  (${p.seed})`}</Text> : null}
            </Text>
            {p.winner ? <Icon name="check" size={16} color={t.win} /> : null}
            {p.sets.map((s, k) => (
              <Text key={k} v="mono" style={{ width: 22, textAlign: 'center' }} color={p.winner ? t.text : t.textDim}>
                {s ?? ''}
                {p.tiebreaks[k] !== null && p.tiebreaks[k] !== undefined ? <Text v="tiny" muted>{p.tiebreaks[k]}</Text> : null}
              </Text>
            ))}
          </Row>
        ))}
      </View>
    </Glass>
  );
}

export function TennisView({ board }: { board: TennisBoard }) {
  const draws = [...new Set(board.matches.map((m) => m.draw))].filter((d) => d);
  const [draw, setDraw] = useState(draws.find((d) => /singles/i.test(d)) ?? draws[0] ?? '');
  const shown = board.matches
    .filter((m) => m.draw === draw && m.players.every((p) => p.name !== 'TBD'))
    .sort((a, b) => (a.state === 'in' ? -1 : 0) - (b.state === 'in' ? -1 : 0) || (a.state === 'pre' && b.state === 'pre' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start)));
  if (!board.tournaments.length) return <EmptyState icon="tennis" title="No tournament this week" body="Check back when the next event starts." />;
  return (
    <View>
      {board.tournaments.map((tn) => (
        <Text key={tn.id} v="h3" style={{ marginBottom: 2 }}>
          {tn.name}
          {tn.venue ? <Text v="small" dim>{`  ·  ${tn.venue}`}</Text> : null}
        </Text>
      ))}
      <ChipRow>
        {draws.map((d) => (
          <Chip key={d} label={d} selected={d === draw} onPress={() => setDraw(d)} />
        ))}
      </ChipRow>
      <View style={{ height: space.sm }} />
      {shown.length ? shown.slice(0, 60).map((m) => <TennisRow key={m.id} m={m} />) : <EmptyState icon="tennis" title="No matches to show" />}
    </View>
  );
}

export function RankingsView({ rows }: { rows: RankRow[] }) {
  const t = useTheme();
  return (
    <Glass padded={false}>
      {rows.map((r, i) => (
        <Row key={r.id ?? r.rank} gap={10} style={{ paddingHorizontal: space.lg, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: t.glassBorder }}>
          <Text v="small" style={{ width: 28, fontWeight: '800' }} color={r.rank <= 3 ? t.brand : t.textDim}>
            {r.rank}
          </Text>
          <Flag url={r.flag} />
          <Text style={{ flex: 1, fontWeight: r.rank <= 10 ? '700' : '500' }} numberOfLines={1}>
            {r.name}
          </Text>
          {r.previous && r.previous !== r.rank ? (
            <Icon name={r.previous > r.rank ? 'arrow-up' : 'arrow-down'} size={14} color={r.previous > r.rank ? t.win : t.loss} />
          ) : null}
          <Text v="mono" style={{ minWidth: 56, textAlign: 'right' }}>
            {r.points?.toLocaleString() ?? ''}
          </Text>
        </Row>
      ))}
    </Glass>
  );
}

// ------------------------------------------------------------------ Formula 1
export function F1View({ board }: { board: F1Board }) {
  const t = useTheme();
  const now = Date.now();
  const next = board.calendar.find((c) => Date.parse(c.end ?? c.start) >= now);
  return (
    <View style={{ gap: space.md }}>
      {board.current.map((w) => (
        <Glass key={w.id}>
          <Text v="label" dim>
            {Date.parse(w.end ?? w.start) < now ? 'Latest race weekend' : 'This race weekend'}
          </Text>
          <Text v="h2" style={{ marginTop: 2 }}>
            {w.name}
          </Text>
          <Text v="small" dim>
            {[w.circuit, w.city].filter(Boolean).join(', ')}
          </Text>
          {w.sessions.map((s) => (
            <View key={s.name} style={{ marginTop: space.md }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text v="h3">{s.name === 'Qual' ? 'Qualifying' : s.name}</Text>
                <Text v="tiny" color={s.state === 'in' ? t.live : t.textMuted} style={{ fontWeight: '800' }}>
                  {s.state === 'in' ? 'LIVE' : `${dayLabel(new Date(s.start))} ${kickoffTime(s.start)}`}
                </Text>
              </Row>
              {s.results.slice(0, s.name === 'Race' ? 10 : 3).map((r) => (
                <Row key={`${s.name}-${r.pos}`} gap={8} style={{ paddingVertical: 4 }}>
                  <Text v="small" style={{ width: 22, fontWeight: '800' }} color={r.pos <= 3 ? t.brand : t.textDim}>
                    {s.state === 'pre' ? '' : r.pos}
                  </Text>
                  <Flag url={r.flag} size={13} />
                  <Text v="small" style={{ flex: 1, fontWeight: r.winner ? '800' : '500' }}>
                    {r.driver}
                  </Text>
                  {r.winner ? <Icon name="trophy" size={14} color={t.pending} /> : null}
                </Row>
              ))}
            </View>
          ))}
        </Glass>
      ))}
      {next ? (
        <Glass tint={t.brand}>
          <Text v="label" dim>
            Next on the calendar
          </Text>
          <Text v="h3" style={{ marginTop: 2 }}>
            {next.name}
          </Text>
          <Text v="small" dim>
            {new Date(next.start).toLocaleDateString([], { day: 'numeric', month: 'long' })}
          </Text>
        </Glass>
      ) : null}
    </View>
  );
}

export function F1StandingsView({ rows, team }: { rows: F1Standing[]; team?: boolean }) {
  const t = useTheme();
  const max = Math.max(1, ...rows.map((r) => r.points));
  return (
    <Glass padded={false}>
      {rows.map((r, i) => (
        <View key={`${r.rank}-${r.name}`} style={{ paddingHorizontal: space.lg, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: t.glassBorder }}>
          <Row gap={10}>
            <Text v="small" style={{ width: 24, fontWeight: '800' }} color={r.rank <= 3 ? t.brand : t.textDim}>
              {r.rank}
            </Text>
            {team ? <View style={{ width: 4, height: 18, borderRadius: 2, backgroundColor: r.color ?? t.textMuted }} /> : <Flag url={r.flag} />}
            <Text style={{ flex: 1, fontWeight: r.rank <= 3 ? '800' : '500' }} numberOfLines={1}>
              {r.name}
            </Text>
            <Text v="mono">{r.points}</Text>
          </Row>
          <View style={{ height: 3, marginTop: 6, marginLeft: 34, borderRadius: 2, backgroundColor: alpha(t.text, 0.08) }}>
            <View style={{ width: `${(100 * r.points) / max}%`, height: 3, borderRadius: 2, backgroundColor: team && r.color ? r.color : t.brand }} />
          </View>
        </View>
      ))}
    </Glass>
  );
}

// ------------------------------------------------------------------ cricket
export function CricketView({ matches }: { matches: CricketMatch[] }) {
  const t = useTheme();
  const [state, setState] = useState<'in' | 'post' | 'pre'>(matches.some((m) => m.state === 'in') ? 'in' : 'post');
  const comps = [...new Set(matches.filter((m) => m.state === state).map((m) => m.competition))];
  return (
    <View>
      <ChipRow>
        <Chip label={`Live (${matches.filter((m) => m.state === 'in').length})`} selected={state === 'in'} onPress={() => setState('in')} />
        <Chip label="Results" selected={state === 'post'} onPress={() => setState('post')} />
        <Chip label="Upcoming" selected={state === 'pre'} onPress={() => setState('pre')} />
      </ChipRow>
      {!comps.length ? <EmptyState icon="cricket" title="Nothing here right now" /> : null}
      {comps.map((c) => (
        <View key={c} style={{ marginTop: space.md }}>
          <Text v="label" dim style={{ marginBottom: space.sm }}>
            {c}
          </Text>
          {matches
            .filter((m) => m.competition === c && m.state === state)
            .map((m) => (
              <Glass key={m.id} style={{ marginBottom: space.sm }} padded={false}>
                <View style={{ padding: space.md, gap: 6 }}>
                  <Text v="tiny" muted numberOfLines={1}>
                    {[m.description, m.format, m.venue].filter(Boolean).join(' · ')}
                  </Text>
                  {m.teams.map((tm, i) => (
                    <Row key={i} gap={8}>
                      <TeamBadge team={{ id: `${m.id}-${i}`, name: tm.name, short_name: tm.name, code: tm.abbr, color: '#334155', logo: tm.logo }} size={22} />
                      <Text style={{ flex: 1, fontWeight: tm.winner ? '800' : '500' }} numberOfLines={1}>
                        {tm.name}
                      </Text>
                      <Text v="mono" color={tm.winner ? t.text : t.textDim}>
                        {tm.score}
                      </Text>
                    </Row>
                  ))}
                  <Text v="small" color={m.state === 'in' ? t.live : t.textDim} style={{ fontWeight: '700' }}>
                    {m.state === 'pre' ? `${dayLabel(new Date(m.start))} ${kickoffTime(m.start)}${m.status ? ` · ${m.status}` : ''}` : m.status}
                  </Text>
                </View>
              </Glass>
            ))}
        </View>
      ))}
    </View>
  );
}
