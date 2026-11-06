import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { BRAND, useTheme } from '@/theme/theme';

import { Text } from './ui';

/** The MK Sports mark (same geometry as branding/mark.svg). */
export function LogoMark({ size = 36, mono }: { size?: number; mono?: string }) {
  const fill = mono ?? 'url(#mk)';
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="MK Sports">
      <Defs>
        <LinearGradient id="mk" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={BRAND.green} />
          <Stop offset="1" stopColor={BRAND.cyan} />
        </LinearGradient>
      </Defs>
      <Path fill={fill} d="M15.20 67.72 L21.53 31.84 L30.50 31.84 L36.35 45.10 L46.88 31.84 L55.85 31.84 L49.52 67.72 L40.94 67.72 L44.59 47.05 L33.74 59.92 L27.43 47.05 L23.78 67.72 Z" />
      <Path fill={fill} d="M54.20 67.72 L60.53 31.84 L69.11 31.84 L66.63 45.88 L78.47 31.84 L88.61 31.84 L72.58 49.78 L83.06 67.72 L72.92 67.72 L65.19 54.07 L62.78 67.72 L54.20 67.72 Z" />
      <Path fill={fill} d="M10.56 78.64 C 35.52 87.22, 65.16 84.88, 87.00 69.28 C 68.28 81.76, 38.64 83.32, 10.56 78.64 Z" />
      <Circle cx={90.12} cy={22.48} r={5.85} fill={mono ?? '#FFFFFF'} />
    </Svg>
  );
}

/** Mark + wordmark, for headers. */
export function Wordmark({ size = 34, color }: { size?: number; color?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessible accessibilityRole="header" accessibilityLabel="MK Sports">
      <LogoMark size={size} />
      <Text style={{ fontSize: size * 0.58, fontWeight: '900', letterSpacing: -0.4, fontStyle: 'italic' }} color={color ?? t.text}>
        MK{' '}
        <Text style={{ fontSize: size * 0.58, fontWeight: '900', fontStyle: 'italic' }} color={color ?? t.brand}>
          SPORTS
        </Text>
      </Text>
    </View>
  );
}
