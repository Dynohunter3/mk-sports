/**
 * Motion and feel: springy presses, haptics, entrances, count-ups, pulses, skeletons and confetti.
 * Built on React Native's own Animated API (transforms and opacity run on the native driver), so there is
 * no extra native library. Everything respects the "Animations" and "Vibration" settings and the system's
 * reduce-motion setting.
 */
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Dimensions, Easing, Platform, Pressable, PressableProps, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

// ------------------------------------------------------------------ settings
let hapticsOn = true;
let motionOn = true;
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((r) => {
    reduceMotion = !!r;
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (r: boolean) => {
  reduceMotion = !!r;
});

/** Called by the app shell whenever the settings change. */
export function setFeedback(o: { haptics?: boolean; motion?: boolean }) {
  if (o.haptics !== undefined) hapticsOn = o.haptics;
  if (o.motion !== undefined) motionOn = o.motion;
}
export const motionEnabled = () => motionOn && !reduceMotion;

function buzz(f: () => Promise<void>) {
  if (!hapticsOn || Platform.OS === 'web') return;
  f().catch(() => undefined);
}
export const haptic = {
  tap: () => buzz(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  select: () => buzz(() => Haptics.selectionAsync()),
  thud: () => buzz(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => buzz(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warn: () => buzz(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
export type HapticKind = keyof typeof haptic | false;

// ------------------------------------------------------------------ press
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A pressable that dips and springs back (with a light haptic tap). */
export function PressableScale({
  children,
  onPress,
  style,
  scaleTo = 0.96,
  feedback = 'tap',
  disabled,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & { children: ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number; feedback?: HapticKind }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.spring(s, { toValue: v, useNativeDriver: true, speed: 40, bounciness: v === 1 ? 12 : 0 }).start();
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        if (motionEnabled()) to(scaleTo);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        rest.onPressOut?.(e);
      }}
      onPress={(e) => {
        if (feedback) haptic[feedback]();
        onPress?.(e);
      }}
      style={[style, { transform: [{ scale: s }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

// ------------------------------------------------------------------ entrances
/** Fades and rises into place once, after `delay` ms (use index * 60 for a stagger). */
export function FadeIn({ children, delay = 0, from = 16, style }: { children: ReactNode; delay?: number; from?: number; style?: StyleProp<ViewStyle> }) {
  const on = motionEnabled();
  const a = useRef(new Animated.Value(on ? 0 : 1)).current;
  useEffect(() => {
    if (!on) return;
    Animated.timing(a, { toValue: 1, duration: 460, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [a, delay, on]);
  return <Animated.View style={[style, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] }]}>{children}</Animated.View>;
}

/** Stagger helper: a short delay for the first items of a list, none for the rest. */
export const stagger = (i: number, step = 55) => (i < 10 ? i * step : 0);

/** Springs in from small (badges, icons, results). */
export function Pop({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const on = motionEnabled();
  const a = useRef(new Animated.Value(on ? 0 : 1)).current;
  useEffect(() => {
    if (!on) return;
    Animated.sequence([Animated.delay(delay), Animated.spring(a, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 14 })]).start();
  }, [a, delay, on]);
  return <Animated.View style={[style, { opacity: a.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }), transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] }]}>{children}</Animated.View>;
}

/** A gentle idle bob (hero crests, empty-state icons). */
export function Float({ children, distance = 5, duration = 1800, style }: { children: ReactNode; distance?: number; duration?: number; style?: StyleProp<ViewStyle> }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!motionEnabled()) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a, duration]);
  return <Animated.View style={[style, { transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -distance] }) }] }]}>{children}</Animated.View>;
}

// ------------------------------------------------------------------ numbers
/** Counts from 0 (or the previous value) up to `value`; render receives the current number. */
export function CountUp({ value, duration = 900, delay = 0, render }: { value: number; duration?: number; delay?: number; render: (v: number) => ReactNode }) {
  const [shown, setShown] = useState(motionEnabled() ? 0 : value);
  const prev = useRef(0);
  useEffect(() => {
    if (!motionEnabled()) {
      setShown(value);
      return;
    }
    const a = new Animated.Value(prev.current);
    const id = a.addListener(({ value: v }) => setShown(v));
    Animated.timing(a, { toValue: value, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(() => {
      prev.current = value;
    });
    return () => a.removeListener(id);
  }, [value, duration, delay]);
  return <>{render(shown)}</>;
}

/** 0 -> 1 once on mount (for bars and rings that fill in). */
export function useGrow(delay = 0, duration = 750): Animated.Value {
  const on = motionEnabled();
  const a = useRef(new Animated.Value(on ? 0 : 1)).current;
  useEffect(() => {
    if (!on) return;
    Animated.timing(a, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [a, delay, duration, on]);
  return a;
}

// ------------------------------------------------------------------ live
/** A dot with an expanding ring, for live matches. */
export function PulseDot({ color, size = 8 }: { color: string; size?: number }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!motionEnabled()) return;
    const loop = Animated.loop(Animated.timing(a, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [a]);
  return (
    <View style={{ width: size * 2.4, height: size * 2.4, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size,
          backgroundColor: color,
          opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
        }}
      />
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: color }} />
    </View>
  );
}

// ------------------------------------------------------------------ loading
/** A placeholder block with a moving sheen (instead of a spinner). */
export function Skeleton({ height = 16, width = '100%', radius = 8, style, base = 'rgba(255,255,255,0.07)' }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle>; base?: string }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!motionEnabled()) return;
    const loop = Animated.loop(Animated.timing(a, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [a]);
  return (
    <View style={[{ height, width, borderRadius: radius, backgroundColor: base, overflow: 'hidden' }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [-320, 320] }) }] }]}>
        <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ width: 200, height: '100%' }} />
      </Animated.View>
    </View>
  );
}

/** A football that bounces with its shadow: the app's loading indicator. */
export function BouncingBall({ color, size = 34, children }: { color: string; size?: number; children: ReactNode }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  return (
    <View style={{ alignItems: 'center', height: size * 2.2, justifyContent: 'flex-end' }}>
      <Animated.View style={{ transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 1.1] }) }, { rotate: a.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '160deg'] }) }] }}>
        {children}
      </Animated.View>
      <Animated.View
        style={{
          width: size * 0.9,
          height: 6,
          borderRadius: 6,
          marginTop: 4,
          backgroundColor: color,
          opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.12] }),
          transform: [{ scaleX: a.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }) }],
        }}
      />
    </View>
  );
}

// ------------------------------------------------------------------ celebration
type Piece = { x: number; dx: number; spin: number; dur: number; delay: number; color: string; w: number; h: number; rise: number };

/** A one-shot confetti burst over the whole screen. Change `burst` (e.g. a counter) to fire again. */
export function Confetti({ burst, colors, count = 46 }: { burst: number; colors: string[]; count?: number }) {
  const { width, height } = Dimensions.get('window');
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: width / 2 + (Math.random() - 0.5) * width * 0.3,
        dx: (Math.random() - 0.5) * width * 1.1,
        spin: (Math.random() - 0.5) * 900,
        dur: 1700 + Math.random() * 1100,
        delay: Math.random() * 180,
        color: colors[i % colors.length],
        w: 6 + Math.random() * 6,
        h: 10 + Math.random() * 8,
        rise: height * (0.18 + Math.random() * 0.22),
      })),
    // a new set each burst
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [burst, count, width, height],
  );
  const progress = useRef(pieces.map(() => new Animated.Value(0))).current;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!burst || !motionEnabled()) return;
    setVisible(true);
    progress.forEach((p) => p.setValue(0));
    Animated.parallel(progress.map((p, i) => Animated.timing(p, { toValue: 1, duration: pieces[i].dur, delay: pieces[i].delay, easing: Easing.linear, useNativeDriver: true }))).start(() => setVisible(false));
  }, [burst, pieces, progress]);
  if (!visible) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((pc, i) => {
        const p = progress[i];
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: pc.x,
              top: height * 0.32,
              width: pc.w,
              height: pc.h,
              borderRadius: 2,
              backgroundColor: pc.color,
              opacity: p.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, pc.dx] }) },
                { translateY: p.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, -pc.rise, height * 0.75] }) },
                { rotate: p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${pc.spin}deg`] }) },
              ],
            }}
          />
        );
      })}
    </View>
  );
}
