/** Line-ups on a pitch (one team at a time, full pitch) and a shot map. */
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';

import type { Lineup, LineupPlayer, Shot } from '@/api/types';
import { xgFor } from '@/engine/xg';
import { alpha, luminance, mix, useTheme } from '@/theme/theme';

import { PlayerPhoto } from './crest';
import { Icon, Row, Text } from './ui';

const lastName = (p: LineupPlayer) => {
  const parts = p.short.split(' ');
  return parts.length > 1 && parts[0].endsWith('.') ? parts.slice(1).join(' ') : p.short;
};

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

const PlayerDot = memo(function PlayerDot({ p, color, onPress, size, width }: { p: LineupPlayer; color: string; onPress: (p: LineupPlayer) => void; size: number; width: number }) {
  return (
    <Pressable onPress={() => onPress(p)} accessibilityRole="button" accessibilityLabel={`${p.name}, number ${p.jersey ?? ''}`} style={{ alignItems: 'center', width }} hitSlop={4}>
      <View>
        <PlayerPhoto url={p.headshot} jersey={p.jersey} color={color} size={size} ring="#FFFFFF" badge />
        {p.yellow || p.red ? <View style={[s.card, { backgroundColor: p.red ? '#EF4444' : '#FACC15' }]} /> : null}
        {p.subbedOut !== null ? (
          <View style={[s.sub, { backgroundColor: '#EF4444' }]}>
            <Icon name="arrow-down-bold" size={11} color="#fff" />
          </View>
        ) : null}
      </View>
      <Text style={{ fontSize: 12.5, fontWeight: '800', marginTop: 5, textAlign: 'center', lineHeight: 15, textShadowColor: 'rgba(0,0,0,0.65)', textShadowRadius: 3, alignSelf: 'stretch' }} color="#FFFFFF" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {lastName(p)}
      </Text>
      {p.goals || p.assists || p.ownGoals || p.subbedOut ? (
        <Row gap={3} style={{ marginTop: 2 }}>
          {Array.from({ length: Math.min(3, p.goals) }).map((_, i) => (
            <Icon key={`g${i}`} name="soccer" size={12} color="#FFFFFF" />
          ))}
          {p.ownGoals ? <Icon name="soccer" size={12} color="#F87171" /> : null}
          {p.assists ? (
            <Text style={{ fontSize: 10, fontWeight: '900' }} color="#A7F3D0">
              {`A${p.assists > 1 ? p.assists : ''}`}
            </Text>
          ) : null}
          {p.subbedOut ? (
            <Text style={{ fontSize: 10, fontWeight: '900' }} color="#FECACA">
              {`${p.subbedOut}`}
            </Text>
          ) : null}
        </Row>
      ) : null}
    </Pressable>
  );
});

function PitchMarkings() {
  const line = 'rgba(255,255,255,0.38)';
  const b = { borderColor: line, borderWidth: 1.5 };
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { margin: 8, borderRadius: 4 }, b]} />
      <View style={{ position: 'absolute', left: 8, right: 8, top: '50%', height: 1.5, backgroundColor: line }} />
      <View style={[{ position: 'absolute', left: '50%', top: '50%', width: 96, height: 96, borderRadius: 48, marginLeft: -48, marginTop: -48 }, b]} />
      {(['top', 'bottom'] as const).map((side) => (
        <View key={side}>
          <View style={[{ position: 'absolute', left: '22%', right: '22%', height: '13%', [side]: 8 }, b, side === 'top' ? { borderTopWidth: 0 } : { borderBottomWidth: 0 }]} />
          <View style={[{ position: 'absolute', left: '37%', right: '37%', height: '5%', [side]: 8 }, b, side === 'top' ? { borderTopWidth: 0 } : { borderBottomWidth: 0 }]} />
        </View>
      ))}
    </View>
  );
}

/** One team on a full pitch: goalkeeper at the top, attacking downwards, with room to breathe. */
export function TeamPitch({ lineup, color, onPlayer }: { lineup: Lineup; color: string; onPlayer: (p: LineupPlayer) => void }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const height = Math.max(520, w * 1.38);
  const size = w < 360 ? 46 : 52;
  const rows = lineup.rows;
  const top = 26;
  const bottom = 92; // room for the last row's names and goal/sub marks
  const most = Math.max(1, ...rows.map((r) => r.length));
  const width = Math.min(size + 48, (w - 16) / most);
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ borderRadius: 18, overflow: 'hidden', height, borderWidth: 1, borderColor: t.glassBorder }}>
      <LinearGradient colors={[mix(t.pitch, '#000000', 0.15), t.pitch, mix(t.pitch, '#000000', 0.15)]} style={StyleSheet.absoluteFill} />
      {Array.from({ length: 10 }).map((_, i) => (
        <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${i * 10}%`, height: '10%', backgroundColor: i % 2 ? 'rgba(255,255,255,0.035)' : 'transparent' }} />
      ))}
      <PitchMarkings />
      {w
        ? rows.map((row, i) => {
            const frac = rows.length > 1 ? i / (rows.length - 1) : 0;
            const y = top + frac * (height - top - bottom);
            return (
              <View key={`${lineup.side}-${i}`} style={{ position: 'absolute', left: 0, right: 0, top: y, flexDirection: 'row', justifyContent: 'space-evenly' }}>
                {[...row].reverse().map((p) => (
                  <PlayerDot key={p.id || p.name} p={p} color={color} onPress={onPlayer} size={size} width={width} />
                ))}
              </View>
            );
          })
        : null}
      {lineup.formation ? (
        <View style={{ position: 'absolute', left: 14, top: 14, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.3)' }}>
          <Text v="h2" color="#FFFFFF" style={{ fontSize: 16, lineHeight: 19 }}>
            {lineup.formation}
          </Text>
        </View>
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

const s = StyleSheet.create({
  card: { position: 'absolute', left: -4, top: -2, width: 9, height: 12, borderRadius: 2, borderWidth: 1, borderColor: '#fff' },
  sub: { position: 'absolute', right: -6, top: -4, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#fff' },
});
