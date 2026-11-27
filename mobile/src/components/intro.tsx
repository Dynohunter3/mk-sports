/**
 * The short animation between the system splash screen and the app (about 1.4 s, once per cold start).
 *
 * Its first frame is the system splash exactly: the same navy, and the MK mark at the same size (a 160 dp image,
 * branding/mark.svg drawn at 90% in it) in the centre of the screen, so taking over from the system splash is
 * invisible. Then: the mark gathers and pops with a two-colour shockwave, the ball over the K hops, the mark
 * lifts while "MK SPORTS" rises under it, and the whole thing zooms through to reveal the app.
 *
 * It waits for saved settings and fonts before moving (the frame is still the splash, so the wait doesn't show),
 * and leaves as soon as the app is ready and the animation has played. With animations turned off in Settings,
 * or the phone's reduce-motion setting on, it simply fades out.
 */
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgGradient, G, Path, Stop } from 'react-native-svg';

import { FONTS } from '@/theme/fonts';
import { BRAND } from '@/theme/theme';

const native = Platform.OS !== 'web';
const BOX = 160; // the system splash image size (app.json: expo-splash-screen imageWidth)
const MARK = BOX * 0.9; // the mark inside it (scripts/render-brand.js: splash-icon scale 0.9)
const PAD = (BOX - MARK) / 2;
// the ball (circle cx 104, cy 16, r 7.5 inside translate(9 10) scale(0.78) in mark.svg), in dp inside the box
const BALL_R = 7.5 * 0.78 * (MARK / 100);
const BALL_X = PAD + (9 + 104 * 0.78) * (MARK / 100);
const BALL_Y = PAD + (10 + 16 * 0.78) * (MARK / 100);
const LIFT = -30; // how far the mark rises to make room for the name
const MIN_MS = 1050; // the intro's own length before it may leave

function Mark() {
  return (
    <Svg width={MARK} height={MARK} viewBox="0 0 100 100">
      <Defs>
        <SvgGradient id="introMk" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={BRAND.green} />
          <Stop offset="1" stopColor={BRAND.cyan} />
        </SvgGradient>
      </Defs>
      <G transform="translate(9 10) scale(0.78)">
        <G transform="translate(13 0) skewX(-10)" fill="url(#introMk)">
          <Path d="M8 74 L8 28 L19.5 28 L30 45 L40.5 28 L52 28 L52 74 L41 74 L41 47.5 L30 64 L19 47.5 L19 74 Z" />
          <Path d="M58 74 L58 28 L69 28 L69 46 L81 28 L94 28 L77.5 51 L95 74 L82 74 L69 56.5 L69 74 Z" />
        </G>
        <Path d="M2 88 C 34 99, 72 96, 100 76 C 76 92, 38 94, 2 88 Z" fill="url(#introMk)" />
      </G>
    </Svg>
  );
}

export function IntroSplash({ start, ready, animate, onDone }: { start: boolean; ready: boolean; animate: boolean; onDone: () => void }) {
  const pop = useRef(new Animated.Value(1)).current; // mark scale
  const ring = useRef(new Animated.Value(0)).current; // shockwave 0..1
  const ball = useRef(new Animated.Value(0)).current; // ball offset (dp, negative = up)
  const lift = useRef(new Animated.Value(0)).current; // 0..1 mark rises
  const word = useRef(new Animated.Value(0)).current; // 0..1 name appears
  const out = useRef(new Animated.Value(0)).current; // 0..1 exit
  const [played, setPlayed] = useState(false);
  const [mode, setMode] = useState<'wait' | 'full' | 'still'>('wait');
  const leaving = useRef(false);

  // decide once settings are known: the full intro, or a plain fade for reduced motion
  useEffect(() => {
    if (!start || mode !== 'wait') return;
    let alive = true;
    (async () => {
      const reduce = await AccessibilityInfo.isReduceMotionEnabled?.().catch(() => false);
      if (alive) setMode(animate && !reduce ? 'full' : 'still');
    })();
    return () => {
      alive = false;
    };
  }, [start, animate, mode]);

  useEffect(() => {
    if (mode === 'still') {
      setPlayed(true);
      return;
    }
    if (mode !== 'full') return;
    const t = (v: Animated.Value, toValue: number, duration: number, easing = Easing.out(Easing.cubic), delay = 0) =>
      Animated.timing(v, {
        toValue,
        duration,
        easing,
        delay,
        useNativeDriver: native,
      });
    Animated.parallel([
      // gather, then pop with a little overshoot
      Animated.sequence([
        t(pop, 0.9, 130, Easing.inOut(Easing.quad)),
        Animated.spring(pop, {
          toValue: 1,
          friction: 4,
          tension: 160,
          useNativeDriver: native,
        }),
      ]),
      t(ring, 1, 700, Easing.out(Easing.quad), 120),
      // the ball hops over the K and bounces back
      Animated.sequence([Animated.delay(200), t(ball, -24, 200, Easing.out(Easing.quad)), t(ball, 0, 520, Easing.bounce)]),
      t(lift, 1, 460, Easing.out(Easing.cubic), 420),
      t(word, 1, 420, Easing.out(Easing.cubic), 520),
    ]).start();
    const id = setTimeout(() => setPlayed(true), MIN_MS);
    return () => clearTimeout(id);
  }, [mode, pop, ring, ball, lift, word]);

  // leave once the animation has played and the app underneath is ready
  useEffect(() => {
    if (!played || !ready || leaving.current) return;
    leaving.current = true;
    Animated.timing(out, {
      toValue: 1,
      duration: mode === 'full' ? 420 : 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: native,
    }).start(() => onDone());
  }, [played, ready, mode, out, onDone]);

  const ringStyle = (from: number, to: number, color: string, lag: number) => ({
    position: 'absolute' as const,
    width: BOX,
    height: BOX,
    borderRadius: BOX / 2,
    borderWidth: 3,
    borderColor: color,
    opacity: ring.interpolate({
      inputRange: [0, lag, 1],
      outputRange: [0, 0.55, 0],
    }),
    transform: [
      {
        scale: ring.interpolate({
          inputRange: [0, 1],
          outputRange: [from, to],
        }),
      },
    ],
  });

  return (
    <Animated.View
      pointerEvents={played && ready ? 'none' : 'auto'}
      style={[
        StyleSheet.absoluteFill,
        styles.root,
        {
          opacity: out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        },
      ]}
      // the system splash is hidden once this identical frame has been drawn (two frames after layout), so a slow
      // phone never shows a blank navy screen in between
      onLayout={() => requestAnimationFrame(() => requestAnimationFrame(() => SplashScreen.hideAsync().catch(() => undefined)))}
      accessibilityLabel="MK Sports"
    >
      <View style={styles.centre}>
        <View style={styles.slot}>
          <Animated.View style={ringStyle(0.45, 2.3, BRAND.green, 0.08)} />
          <Animated.View style={ringStyle(0.3, 1.8, BRAND.cyan, 0.2)} />
          <Animated.View
            style={{
              width: BOX,
              height: BOX,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [
                {
                  translateY: lift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, LIFT],
                  }),
                },
                {
                  scale: Animated.multiply(
                    pop,
                    out.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.45],
                    }),
                  ),
                },
              ],
            }}
          >
            <Mark />
            <Animated.View
              style={{
                position: 'absolute',
                left: BALL_X - BALL_R,
                top: BALL_Y - BALL_R,
                width: BALL_R * 2,
                height: BALL_R * 2,
                borderRadius: BALL_R,
                backgroundColor: '#FFFFFF',
                transform: [{ translateY: ball }],
              }}
            />
          </Animated.View>
          <Animated.View
            style={{
              position: 'absolute',
              top: BOX + LIFT - 18, // just under the swoosh once the mark has risen
              left: -120,
              width: BOX + 240,
              alignItems: 'center',
              opacity: Animated.multiply(
                word,
                out.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [1, 0, 0],
                }),
              ),
              transform: [
                {
                  translateY: word.interpolate({
                    inputRange: [0, 1],
                    outputRange: [16, 0],
                  }),
                },
              ],
            }}
          >
            <Text style={styles.name}>
              MK <Text style={{ color: BRAND.green }}>SPORTS</Text>
            </Text>
            <Text style={styles.tag}>Scores · Predictions · Play</Text>
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: BRAND.ink, zIndex: 1000, elevation: 1000 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  slot: {
    width: BOX,
    height: BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontFamily: FONTS.display,
    fontSize: 34,
    letterSpacing: 5,
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  tag: {
    marginTop: 4,
    fontSize: 12,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: 'rgba(238,243,250,0.6)',
    fontWeight: '600',
  },
});
