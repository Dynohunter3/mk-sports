/** Line-ups (both teams on one pitch) and a shot map. */
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient as SvgGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

import type { Lineup, LineupPlayer, Shot } from '@/api/types';
import { xgFor } from '@/engine/xg';
import { FONTS } from '@/theme/fonts';
import { alpha, luminance, mix, onColor, useTheme } from '@/theme/theme';

import { Crest, PlayerPhoto } from './crest';
import { Icon, Row, Text } from './ui';

/** Two kit colours that can be told apart on the pitch. */
export function kitColors(home: string, away: string): [string, string] {
  const dist = (a: string, b: string) => {
    const x = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [p, q] = [x(a), x(b)];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  };
  const ok = (c: string) => /^#[0-9a-f]{6}$/i.test(c);
  const h = ok(home) ? home : '#2563EB';
  let a = ok(away) ? away : '#F8FAFC';
  if (dist(h, a) < 90) a = luminance(h) > 0.5 ? '#111827' : '#F8FAFC';
  return [h, a];
}

// ------------------------------------------------------------------ player cards
/** A shirt in the kit's colours with the number on it: the card for players without a photo. */
function KitShirt({ size, color, trim, number }: { size: number; color: string; trim: string; number: string | null }) {
  const ink = onColor(color);
  const d = 'M30 8 L42 4 Q50 12 58 4 L70 8 L92 26 L80 42 L72 36 L72 92 Q50 96 28 92 L28 36 L20 42 L8 26 Z';
  // gradient ids are document-wide: one per kit colour, or every shirt would take the first team's colour
  const gid = `shirt-${color.replace('#', '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <SvgGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={mix(color, '#FFFFFF', 0.18)} />
          <Stop offset="1" stopColor={mix(color, '#000000', 0.22)} />
        </SvgGradient>
      </Defs>
      <Path d={d} fill={`url(#${gid})`} stroke={alpha('#000000', 0.35)} strokeWidth={2} strokeLinejoin="round" />
      {/* sleeve cuffs and collar in the trim colour */}
      <Path d="M8 26 L20 42 L24 39 L12 23 Z M92 26 L80 42 L76 39 L88 23 Z" fill={trim} opacity={0.95} />
      <Path d="M42 4 Q50 12 58 4 L55 3 Q50 8 45 3 Z" fill={trim} />
      {number ? (
        <SvgText x={50} y={number.length > 1 ? 68 : 69} fontSize={number.length > 1 ? 34 : 38} fontFamily={FONTS.display} fill={ink} textAnchor="middle">
          {number}
        </SvgText>
      ) : null}
    </Svg>
  );
}

const lastName = (p: LineupPlayer) => {
  const parts = p.short.split(' ');
  return parts.length > 1 && parts[0].endsWith('.') ? parts.slice(1).join(' ') : p.short;
};

/** One player on the pitch: photo (or the kit shirt), ring in the kit colour, and what happened to him. */
const PlayerToken = memo(function PlayerToken({ p, kit, trim, size, width, team, league, onPress }: { p: LineupPlayer; kit: string; trim: string; size: number; width: number; team: string; league?: string; onPress: (p: LineupPlayer) => void }) {
  const saves = p.position === 'G' ? p.stats.SV ?? 0 : 0;
  const chips: { text: string; tone: 'stat' | 'assist' }[] = [];
  if (p.xg !== undefined && p.xg >= 0.01) chips.push({ text: `${p.xg.toFixed(2)} xG`, tone: 'stat' });
  if (saves > 0) chips.push({ text: `${saves} save${saves === 1 ? '' : 's'}`, tone: 'stat' });
  if (p.assists) chips.push({ text: p.assists > 1 ? `${p.assists} A` : 'A', tone: 'assist' });
  const label = [
    p.name,
    p.jersey ? `number ${p.jersey}` : '',
    p.goals ? `${p.goals} goal${p.goals > 1 ? 's' : ''}` : '',
    p.assists ? `${p.assists} assist${p.assists > 1 ? 's' : ''}` : '',
    p.yellow ? 'booked' : '',
    p.red ? 'sent off' : '',
    p.subbedOut !== null ? `substituted ${p.subbedOut}` : '',
    p.xg ? `${p.xg.toFixed(2)} expected goals` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable onPress={() => onPress(p)} accessibilityRole="button" accessibilityLabel={label} style={{ alignItems: 'center', width }} hitSlop={4}>
      <View style={{ width: size, height: size }}>
        <View style={[st.halo, { width: size + 8, height: size + 8, borderRadius: (size + 8) / 2, backgroundColor: alpha(kit, 0.2) }]} />
        <PlayerPhoto
          url={p.headshot}
          jersey={p.jersey}
          color={kit}
          size={size}
          ring={kit}
          ringWidth={2.5}
          badge
          who={{ id: p.id, name: p.name, team, league }}
          fallback={
            <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2.5, borderColor: kit, backgroundColor: '#0B1430', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <KitShirt size={size * 0.86} color={kit} trim={trim} number={p.jersey} />
            </View>
          }
        />
        {p.yellow || p.red ? <View style={[st.card, { backgroundColor: p.red ? '#EF4444' : '#FACC15' }]} /> : null}
        {p.subbedOut !== null ? (
          <View style={st.subOut}>
            <Icon name="arrow-down-bold" size={10} color="#FFFFFF" />
            {p.subbedOut ? <Text style={st.subText}>{p.subbedOut}</Text> : null}
          </View>
        ) : null}
        {p.goals || p.ownGoals ? (
          <View style={st.goals}>
            <Icon name="soccer" size={13} color={p.goals ? '#0B1430' : '#EF4444'} />
            {p.goals > 1 ? <Text style={st.goalCount}>{p.goals}</Text> : null}
          </View>
        ) : null}
      </View>
      <Text style={st.name} color="#FFFFFF" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {lastName(p)}
      </Text>
      {chips.length ? (
        <View style={{ flexDirection: 'row', gap: 3, marginTop: 3 }}>
          {chips.map((c) => (
            <View key={c.text} style={[st.chip, c.tone === 'assist' ? { backgroundColor: 'rgba(16,185,129,0.85)' } : null]}>
              <Text style={st.chipText}>{c.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
});

// ------------------------------------------------------------------ the pitch
/** Full markings at real proportions (a 68 x 105 m pitch), scaled to the width; the length stretches to fit. */
function PitchSvg({ w, h }: { w: number; h: number }) {
  const m = 10; // inset of the touchlines
  const W = w - 2 * m;
  const u = W / 68; // one metre
  const line = 'rgba(255,255,255,0.55)';
  const sw = 1.6;
  const cx = w / 2;
  const box = (top: boolean) => {
    const y0 = top ? m : h - m;
    const dir = top ? 1 : -1;
    const pa = { w: 40.32 * u, d: 16.5 * u };
    const ga = { w: 18.32 * u, d: 5.5 * u };
    const spot = y0 + dir * 11 * u;
    // the "D": the part of the 9.15 m circle around the spot outside the penalty area
    const r = 9.15 * u;
    const edge = y0 + dir * pa.d;
    const dy = Math.abs(edge - spot);
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    return (
      <G key={top ? 't' : 'b'}>
        <Rect x={cx - pa.w / 2} y={top ? y0 : y0 - pa.d} width={pa.w} height={pa.d} stroke={line} strokeWidth={sw} fill="rgba(255,255,255,0.03)" />
        <Rect x={cx - ga.w / 2} y={top ? y0 : y0 - ga.d} width={ga.w} height={ga.d} stroke={line} strokeWidth={sw} fill="none" />
        <Circle cx={cx} cy={spot} r={2} fill={line} />
        <Path d={`M ${cx - dx} ${edge} A ${r} ${r} 0 0 ${top ? 0 : 1} ${cx + dx} ${edge}`} stroke={line} strokeWidth={sw} fill="none" />
        {/* the goal, just outside the line */}
        <Rect x={cx - 3.66 * u} y={top ? y0 - 6 : y0} width={7.32 * u} height={6} stroke={line} strokeWidth={sw} fill="rgba(255,255,255,0.12)" />
      </G>
    );
  };
  const corner = 1.2 * u + 4;
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="light" cx="50%" cy="50%" r="75%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.1} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.32} />
        </RadialGradient>
      </Defs>
      {/* mown stripes */}
      {Array.from({ length: 16 }).map((_, i) => (
        <Rect key={i} x={0} y={(h / 16) * i} width={w} height={h / 16 + 0.5} fill={i % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.035)'} />
      ))}
      <Rect x={0} y={0} width={w} height={h} fill="url(#light)" />
      <Rect x={m} y={m} width={W} height={h - 2 * m} stroke={line} strokeWidth={sw} fill="none" rx={2} />
      <Line x1={m} x2={w - m} y1={h / 2} y2={h / 2} stroke={line} strokeWidth={sw} />
      <Circle cx={cx} cy={h / 2} r={9.15 * u} stroke={line} strokeWidth={sw} fill="none" />
      <Circle cx={cx} cy={h / 2} r={2.4} fill={line} />
      {box(true)}
      {box(false)}
      {[
        [m, m, 0],
        [w - m, m, 1],
        [m, h - m, 2],
        [w - m, h - m, 3],
      ].map(([x, y, k]) => (
        <Path
          key={k}
          d={k === 0 ? `M ${x} ${y + corner} A ${corner} ${corner} 0 0 0 ${x + corner} ${y}` : k === 1 ? `M ${x - corner} ${y} A ${corner} ${corner} 0 0 0 ${x} ${y + corner}` : k === 2 ? `M ${x + corner} ${y} A ${corner} ${corner} 0 0 0 ${x} ${y - corner}` : `M ${x} ${y - corner} A ${corner} ${corner} 0 0 0 ${x - corner} ${y}`}
          stroke={line}
          strokeWidth={sw}
          fill="none"
        />
      ))}
    </Svg>
  );
}

type Side = { lineup: Lineup; team: { short_name: string; code: string; color: string; logo?: string | null }; kit: string; trim: string };

/** The team's name and formation on a strip at the halfway line. */
function TeamStrip({ s, top }: { s: Side; top: boolean }) {
  return (
    <View style={[st.strip, top ? { bottom: 6 } : { top: 6 }]}>
      <View style={[st.kitDot, { backgroundColor: s.kit, borderColor: s.trim }]} />
      <Crest team={s.team} size={20} />
      <Text style={st.stripName} color="#FFFFFF" numberOfLines={1}>
        {s.team.short_name.toUpperCase()}
      </Text>
      {s.lineup.formation ? <Text style={st.stripFormation}>{s.lineup.formation}</Text> : null}
    </View>
  );
}

/**
 * Both line-ups on one pitch: the home side attacks downwards from the top goal, the away side upwards from the
 * bottom, each player in his formation line, with his photo or kit shirt, goals, cards, substitution and xG.
 */
export function MatchPitch({ home, away, onPlayer, league }: { home: Side; away: Side; onPlayer: (p: LineupPlayer) => void; league?: string }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const size = w < 360 ? 42 : 48;
  const block = size + 46; // photo, name, chip
  const pad = 22; // from the goal line to the keeper
  const strip = 40; // the team strips at the halfway line
  const rows = Math.max(home.lineup.rows.length, away.lineup.rows.length, 4);
  const halfH = pad + strip + (rows - 1) * (block + 4) + block;
  const h = 2 * halfH;
  const place = (s: Side, i: number, n: number, top: boolean) => {
    const frac = n > 1 ? i / (n - 1) : 0;
    const span = halfH - pad - strip - block;
    return top ? pad + frac * span : h - pad - block - frac * span;
  };
  const renderSide = (s: Side, top: boolean) => {
    const n = s.lineup.rows.length;
    const most = Math.max(1, ...s.lineup.rows.map((r) => r.length));
    const width = Math.min(size + 40, (w - 20) / most);
    return s.lineup.rows.map((row, i) => (
      <View key={`${s.lineup.side}-${i}`} style={{ position: 'absolute', left: 10, right: 10, top: place(s, i, n, top), flexDirection: 'row', justifyContent: 'space-evenly' }}>
        {/* the home side faces the viewer, so its left is on the right */}
        {(top ? [...row].reverse() : row).map((p) => (
          <PlayerToken key={p.id || p.name} p={p} kit={s.kit} trim={s.trim} size={size} width={width} team={s.lineup.teamId} league={league} onPress={onPlayer} />
        ))}
      </View>
    ));
  };
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ borderRadius: 22, overflow: 'hidden', height: w ? h : 640, borderWidth: 1, borderColor: t.glassBorder }}>
      <LinearGradient colors={['#1F6B3F', '#2A8A50', '#1F6B3F']} style={StyleSheet.absoluteFill} />
      {w ? <PitchSvg w={w} h={h} /> : null}
      {w ? (
        <>
          <View style={{ position: 'absolute', left: 0, right: 0, top: halfH - strip, height: strip }}>
            <TeamStrip s={home} top />
          </View>
          <View style={{ position: 'absolute', left: 0, right: 0, top: halfH, height: strip }}>
            <TeamStrip s={away} top={false} />
          </View>
          {renderSide(home, true)}
          {renderSide(away, false)}
        </>
      ) : null}
    </View>
  );
}

/** Attempts plotted on one half (both teams attacking the top goal), dot size = xG. */
export function ShotMap({ shots, homeColor, awayColor, homeName, awayName }: { shots: Shot[]; homeColor: string; awayColor: string; homeName: string; awayName: string }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const h = w * 0.72;
  const [hc, ac] = kitColors(homeColor, awayColor);
  const located = shots.filter((s) => s.x !== null && s.y !== null);
  const pos = (s: Shot) => {
    // distance from goal line as a share of half the pitch, and width share
    const unit = s.x! <= 1 && s.y! <= 1;
    const dx = unit ? s.x! : (100 - s.x!) / 50;
    const yf = unit ? s.y! : s.y! / 100;
    return { left: yf * w, top: Math.min(1, dx) * h };
  };
  return (
    <View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: h || 220, borderRadius: 14, overflow: 'hidden', backgroundColor: t.pitch }}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { margin: 6, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', borderTopWidth: 1.5 }]} />
        <View pointerEvents="none" style={{ position: 'absolute', left: '20%', right: '20%', top: 6, height: '31%', borderWidth: 1.5, borderTopWidth: 0, borderColor: 'rgba(255,255,255,0.35)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: '37%', right: '37%', top: 6, height: '10.5%', borderWidth: 1.5, borderTopWidth: 0, borderColor: 'rgba(255,255,255,0.35)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: '45%', right: '45%', top: 0, height: 6, backgroundColor: 'rgba(255,255,255,0.8)' }} />
        {w
          ? located.map((s, i) => {
              const p = pos(s);
              const xg = xgFor(s.x!, s.y!, s.penalty);
              const d = 8 + Math.sqrt(xg) * 26;
              const c = s.side === 'home' ? hc : ac;
              return (
                <View
                  key={i}
                  style={{ position: 'absolute', left: p.left - d / 2, top: p.top - d / 2, width: d, height: d, borderRadius: d / 2, backgroundColor: s.goal ? c : alpha(c, 0.35), borderWidth: s.goal ? 2 : 1.5, borderColor: s.goal ? '#FFFFFF' : c }}
                />
              );
            })
          : null}
      </View>
      <Row style={{ justifyContent: 'center', marginTop: 8 }} gap={14}>
        {(
          [
            [homeName, hc],
            [awayName, ac],
          ] as const
        ).map(([n, c]) => (
          <Row key={n} gap={6}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c, borderWidth: 1, borderColor: t.glassBorder }} />
            <Text v="tiny" dim>
              {n}
            </Text>
          </Row>
        ))}
        <Row gap={6}>
          <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: t.textMuted }} />
          <Text v="tiny" dim>
            goal · bigger = higher xG
          </Text>
        </Row>
      </Row>
    </View>
  );
}

const st = StyleSheet.create({
  halo: { position: 'absolute', left: -4, top: -4 },
  card: { position: 'absolute', left: -3, top: -2, width: 10, height: 13, borderRadius: 2, borderWidth: 1, borderColor: '#FFFFFF', transform: [{ rotate: '-12deg' }] },
  subOut: { position: 'absolute', right: -14, top: -6, flexDirection: 'row', alignItems: 'center', gap: 1, paddingHorizontal: 4, height: 17, borderRadius: 9, backgroundColor: '#E5484D', borderWidth: 1, borderColor: '#FFFFFF' },
  subText: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '900' },
  goals: { position: 'absolute', left: -6, bottom: -3, flexDirection: 'row', alignItems: 'center', gap: 1, paddingHorizontal: 2, height: 18, minWidth: 18, borderRadius: 9, backgroundColor: '#FFFFFF', justifyContent: 'center' },
  goalCount: { color: '#0B1430', fontSize: 10, fontWeight: '900', marginRight: 1 },
  name: { fontSize: 12.5, fontWeight: '800', marginTop: 6, textAlign: 'center', lineHeight: 15, textShadowColor: 'rgba(0,0,0,0.75)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 }, alignSelf: 'stretch' },
  chip: { paddingHorizontal: 6, height: 18, borderRadius: 5, backgroundColor: 'rgba(8,14,30,0.78)', alignItems: 'center', justifyContent: 'center' },
  chipText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '900', fontVariant: ['tabular-nums'] },
  strip: { position: 'absolute', left: 14, right: 14, height: 28, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(5,12,24,0.42)' },
  kitDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  stripName: { fontSize: 13, fontWeight: '900', letterSpacing: 0.6, flexShrink: 1 },
  stripFormation: { marginLeft: 'auto', color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
});
