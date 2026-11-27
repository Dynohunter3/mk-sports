/**
 * "Liquid glass" surfaces: translucent tiles with a soft specular edge, floating over a
 * competition-coloured gradient. The glass look comes from translucency + highlight rather than
 * a live backdrop blur, which keeps scrolling smooth on mid-range Android phones (on the web the
 * browser's backdrop blur is added).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode } from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { alpha, cardShadow, DarkSurface, mix, radius as R, useTheme } from '@/theme/theme';

import { PressableScale } from './motion';

const WEB_BLUR = Platform.OS === 'web' ? ({ backdropFilter: 'blur(18px) saturate(140%)' } as unknown as ViewStyle) : null;

export function Glass({
  children,
  style,
  radius = R.lg,
  strong,
  onPress,
  accessibilityLabel,
  tint,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  strong?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  tint?: string | null;
  padded?: boolean;
}) {
  const t = useTheme();
  // light mode cards are opaque (a see-through card shows its own shadow on Android)
  const fill = tint ? (t.mode === 'dark' ? alpha(tint, 0.22) : mix(tint, '#FFFFFF', 0.9)) : strong ? t.glassStrong : t.glass;
  const body = (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={[t.glassHighlight, 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 0.9 }}
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      />
      {children}
    </>
  );
  const base: StyleProp<ViewStyle> = [
    { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.glassBorder, backgroundColor: fill, overflow: 'hidden' },
    cardShadow(t),
    padded && { padding: 16 },
    style,
  ];
  if (onPress) {
    return (
      <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} scaleTo={0.975} style={base}>
        {body}
      </PressableScale>
    );
  }
  return <View style={base}>{body}</View>;
}

/** Frosted bar for floating chrome (tab bar, sticky headers). */
export function GlassBar({ children, style, radius = R.xl }: { children: ReactNode; style?: StyleProp<ViewStyle>; radius?: number }) {
  const t = useTheme();
  const shadow: ViewStyle = { shadowColor: '#000', shadowOpacity: t.mode === 'dark' ? 0.45 : 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 };
  return (
    <View style={[{ borderRadius: radius }, shadow, style]}>
      <View style={{ borderRadius: radius, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.glassBorder }}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: t.glassStrong }, WEB_BLUR]} />
        <LinearGradient pointerEvents="none" colors={[t.glassHighlight, 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
        {children}
      </View>
    </View>
  );
}

/** Competition-coloured wash behind the top of a screen. */
export function Backdrop({ height = 420 }: { height?: number }) {
  const t = useTheme();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]}>
      {/* vertical, so the wash is fully clear by the bottom edge everywhere (a diagonal one left a visible line) */}
      {t.mode === 'dark' ? (
        <LinearGradient colors={[alpha(t.heroFrom, 0.95), alpha(t.heroFrom, 0)]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ height }} />
      ) : (
        // light: a soft tint of the competition's colour, so dark text on it stays crisp (a deep wash turns muddy)
        <LinearGradient colors={[alpha(t.heroFrom, 0.2), alpha(t.heroFrom, 0.07), alpha(t.heroFrom, 0)]} locations={[0, 0.55, 1]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ height }} />
      )}
      <View style={{ position: 'absolute', top: -120, right: -80, width: 260, height: 260, borderRadius: 130, backgroundColor: alpha(t.brand, t.mode === 'dark' ? 0.12 : 0.07) }} />
    </View>
  );
}

/** Gradient header block in the current competition's colours. */
export function Hero({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <LinearGradient colors={[t.heroFrom, t.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={[{ borderRadius: R.xl, padding: 16, overflow: 'hidden' }, style]}>
      <View pointerEvents="none" style={{ position: 'absolute', right: -40, top: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: alpha(t.brand, 0.16) }} />
      <DarkSurface>{children}</DarkSurface>
    </LinearGradient>
  );
}
