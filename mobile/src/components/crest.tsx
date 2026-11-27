/**
 * Team crests and player photos from the data source's image CDN, requested at the size they
 * are drawn (small files) and cached on disk. Anything that fails to load falls back to the
 * team's colours and initials, so a slow network never leaves a blank hole.
 */
import { Image } from 'expo-image';
import { memo, ReactNode, useEffect, useState } from 'react';
import { PixelRatio, View } from 'react-native';

import { usePlayerPhoto, type Who } from '@/data/photos';
import { onColor, useTheme } from '@/theme/theme';

import { Text } from './ui';

export type CrestTeam = { code: string; color: string; logo?: string | null; name?: string };

/** ESPN's resizer: `/i/...png` at w x h pixels. */
export function sizedImage(url: string, px: number): string {
  const m = /^https:\/\/a\.espncdn\.com(\/i\/[^?#]+\.(?:png|jpg|jpeg))/i.exec(url);
  if (!m) return url;
  return `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${px}&h=${px}`;
}

const pxFor = (size: number) => {
  const want = size * Math.min(3, PixelRatio.get());
  return [40, 64, 96, 128, 200].find((p) => p >= want) ?? 200;
};

function Initials({ team, size }: { team: CrestTeam; size: number }) {
  const t = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: team.color, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.glassBorder }}>
      <Text style={{ fontSize: size * 0.34, fontWeight: '800', color: onColor(team.color) }} numberOfLines={1}>
        {team.code.slice(0, 3)}
      </Text>
    </View>
  );
}

/** The team's real crest, drawn on its own (no badge behind it). */
export const Crest = memo(function Crest({ team, size = 28 }: { team: CrestTeam; size?: number; plate?: boolean }) {
  const [stage, setStage] = useState(0); // 0 resized, 1 original, 2 initials
  useEffect(() => setStage(0), [team.logo]);
  if (!team.logo || stage >= 2) {
    return (
      <View accessibilityElementsHidden importantForAccessibility="no">
        <Initials team={team} size={size} />
      </View>
    );
  }
  const inner = size;
  const uri = stage === 0 ? sizedImage(team.logo, pxFor(inner)) : team.logo;
  const tried = stage;
  const img = (
    <Image
      source={{ uri }}
      style={{ width: inner, height: inner }}
      contentFit="contain"
      cachePolicy="disk"
      key={uri}
      recyclingKey={uri}
      transition={120}
      onError={() => setStage((s) => (s === tried ? s + 1 : s))} // one step per failed URL, even if the error fires twice
      accessibilityLabel={team.name ? `${team.name} crest` : undefined}
    />
  );
  return img;
});

/**
 * Round player photo. For football players (`who` given) a current face crop from Wikimedia Commons
 * (data/photos.ts) comes first; then the data source's photo; then the shirt number.
 */
export const PlayerPhoto = memo(function PlayerPhoto({ url, jersey, color, size = 44, ring, ringWidth = 2, badge, who, fallback }: { url: string | null; jersey: string | null; color: string; size?: number; ring?: string; ringWidth?: number; badge?: boolean; who?: Who | null; fallback?: ReactNode }) {
  const t = useTheme();
  const own = usePlayerPhoto(who);
  const [failed, setFailed] = useState(0); // 1: the Commons crop failed to load, 2: the source photo too
  useEffect(() => setFailed(0), [url, own?.uri]);
  const border = { borderWidth: ringWidth, borderColor: ring ?? t.glassBorder };
  // while a football player's crop is being looked up, show the number rather than flash the old photo
  const src = own && failed < 1 ? own.uri : own === undefined && who ? null : url && failed < 2 ? sizedImage(url, pxFor(size)) : null;
  if (!src) {
    if (fallback) return <>{fallback}</>;
    return (
      <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }, border]}>
        <Text style={{ fontSize: size * 0.4, fontWeight: '900', color: onColor(color) }}>{jersey ?? ''}</Text>
      </View>
    );
  }
  return (
    <View>
      <Image
        source={{ uri: src }}
        style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#E8EDF3' }, border]}
        contentFit="cover"
        contentPosition={own && failed < 1 ? 'center' : 'top'}
        cachePolicy="disk"
        recyclingKey={src}
        transition={own ? 150 : 0}
        onError={() => setFailed((f) => (own && f < 1 ? 1 : 2))}
        accessibilityIgnoresInvertColors
      />
      {badge && jersey ? (
        <View style={{ position: 'absolute', right: -6, bottom: -4, minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 1, borderColor: '#fff', backgroundColor: '#0B1430' }}>
          <Text style={{ fontSize: 10, fontWeight: '900' }} color="#fff">
            {jersey}
          </Text>
        </View>
      ) : null}
    </View>
  );
});
