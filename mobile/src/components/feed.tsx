import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { Article, MatchCard } from '@/api/types';
import { LEAGUE_BY_SLUG } from '@/data/leagues';
import { alpha, leagueColors, mix, radius, space, useTheme } from '@/theme/theme';

import { Glass } from './glass';
import { StatusChip, TeamBadge } from './match';
import { Icon, Row, Text } from './ui';

export function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

export async function openArticle(a: Article) {
  if (!a.url) return;
  try {
    await WebBrowser.openBrowserAsync(a.url, { toolbarColor: '#060A16', controlsColor: '#2CF59A' });
  } catch {
    /* no browser available */
  }
}

/** Compact live / upcoming match tile for horizontal strips. */
export const MatchTile = memo(function MatchTile({ m }: { m: MatchCard }) {
  const t = useTheme();
  const lc = leagueColors(m.league.id);
  const started = m.status === 'live' || m.status === 'finished';
  return (
    <Glass onPress={() => router.push(`/match/${m.id}`)} accessibilityLabel={`${m.home.name} versus ${m.away.name}`} tint={lc?.primary ?? null} style={{ width: 236 }} padded={false}>
      <View style={{ padding: space.md, gap: 8 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text v="tiny" dim numberOfLines={1} style={{ flex: 1, fontWeight: '700' }}>
            {m.league.short_name}
          </Text>
          <StatusChip m={m} />
        </Row>
        {[m.home, m.away].map((tm, i) => {
          const sc = i === 0 ? m.home_score : m.away_score;
          const other = i === 0 ? m.away_score : m.home_score;
          const lead = started && (sc ?? 0) > (other ?? 0);
          return (
            <Row key={tm.id} gap={8}>
              <TeamBadge team={tm} size={24} />
              <Text style={{ flex: 1, fontWeight: lead ? '800' : '600' }} numberOfLines={1}>
                {tm.short_name}
              </Text>
              <Text v="mono" color={started ? (lead ? t.text : t.textDim) : t.textMuted}>
                {started ? sc ?? 0 : ''}
              </Text>
            </Row>
          );
        })}
      </View>
      {m.status === 'live' ? <View style={{ height: 3, backgroundColor: t.live }} /> : <View style={{ height: 3, backgroundColor: alpha(lc?.accent ?? t.brand, 0.7) }} />}
    </Glass>
  );
});

export function MatchStrip({ items }: { items: MatchCard[] }) {
  if (!items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingVertical: space.xs, paddingRight: space.lg }}>
      {items.map((m) => (
        <MatchTile key={m.id} m={m} />
      ))}
    </ScrollView>
  );
}

/** Headline row: thumbnail left, headline right (news lists). */
export const ArticleRow = memo(function ArticleRow({ a, big }: { a: Article; big?: boolean }) {
  const t = useTheme();
  const lg = LEAGUE_BY_SLUG[a.league];
  const [broken, setBroken] = useState(false); // an image that fails to load shows the competition's colours instead
  const fallback = (style: object, size: number) => (
    <LinearGradient colors={[lg?.theme.primary ?? t.brand, mix(lg?.theme.primary ?? t.brand, '#000000', 0.45)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
      <Icon name="newspaper-variant-outline" color="rgba(255,255,255,0.9)" size={size} />
      {lg ? (
        <Text v="tiny" color="rgba(255,255,255,0.85)" style={{ fontWeight: '800', marginTop: 2 }} numberOfLines={1}>
          {lg.shortName}
        </Text>
      ) : null}
    </LinearGradient>
  );
  if (big && a.image && !broken) {
    return (
      <Pressable onPress={() => openArticle(a)} accessibilityRole="link" accessibilityLabel={a.headline} style={({ pressed }) => [{ marginBottom: space.md }, pressed && { opacity: 0.8 }]}>
        <View style={[s.bigWrap, { borderColor: t.glassBorder }]}>
          <Image source={{ uri: a.image }} style={s.bigImg} contentFit="cover" cachePolicy="disk" transition={150} onError={() => setBroken(true)} />
          <View style={[s.bigText, { backgroundColor: alpha('#000000', 0.55) }]}>
            <Text v="tiny" color="#E2E8F0" style={{ fontWeight: '700' }}>
              {[lg?.shortName, timeAgo(a.published)].filter(Boolean).join(' · ')}
            </Text>
            <Text v="h3" color="#FFFFFF" numberOfLines={3} style={{ marginTop: 4, fontSize: 18 }}>
              {a.headline}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={() => openArticle(a)} accessibilityRole="link" accessibilityLabel={a.headline} style={({ pressed }) => [s.row, { borderColor: t.glassBorder }, pressed && { opacity: 0.75 }]}>
      {a.image && !broken ? (
        <Image source={{ uri: a.image }} style={[s.thumb, { backgroundColor: t.surface2 }]} contentFit="cover" cachePolicy="disk" transition={150} onError={() => setBroken(true)} />
      ) : (
        fallback(s.thumb, 26)
      )}
      <View style={{ flex: 1, justifyContent: 'space-between', minHeight: 84 }}>
        <Text style={{ fontWeight: '800', fontSize: 15, lineHeight: 20 }} numberOfLines={3}>
          {a.headline}
        </Text>
        <Row gap={6} style={{ marginTop: 6 }}>
          {a.my_team ? <Icon name="star" size={13} color={t.pending} /> : null}
          <Text v="tiny" muted numberOfLines={1}>
            {[lg?.shortName, timeAgo(a.published), a.type === 'Media' ? 'Video' : null].filter(Boolean).join(' · ')}
          </Text>
        </Row>
      </View>
    </Pressable>
  );
});

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  thumb: { width: 128, height: 84, borderRadius: radius.md },
  bigWrap: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2 },
  bigImg: { width: '100%', aspectRatio: 16 / 9 },
  bigText: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.md },
});
