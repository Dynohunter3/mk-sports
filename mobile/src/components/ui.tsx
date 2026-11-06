import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ComponentProps, memo, ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleProp, StyleSheet, Text as RNText, TextProps, TextStyle, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { alpha, radius, space, TAB_BAR_SPACE, TAP, useTheme } from '@/theme/theme';

import { Backdrop, Glass } from './glass';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = 20, color, style }: { name: string; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <MaterialCommunityIcons name={name as IconName} size={size} color={color ?? t.textDim} style={style} />;
}

type Variant = 'title' | 'h2' | 'h3' | 'body' | 'small' | 'tiny' | 'label' | 'mono';
const VARIANTS: Record<Variant, TextStyle> = {
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  h2: { fontSize: 20, fontWeight: '700' },
  h3: { fontSize: 16, fontWeight: '700' },
  body: { fontSize: 15 },
  small: { fontSize: 13 },
  tiny: { fontSize: 11 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  mono: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
};

export function Text({ v = 'body', dim, muted, color, style, ...rest }: TextProps & { v?: Variant; dim?: boolean; muted?: boolean; color?: string }) {
  const t = useTheme();
  return <RNText {...rest} style={[VARIANTS[v], { color: color ?? (muted ? t.textMuted : dim ? t.textDim : t.text) }, style]} />;
}

export function Screen({
  children,
  scroll = false,
  edges = ['top'],
  padded = true,
  refreshControl,
  tab = false,
  backdrop = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: ('top' | 'bottom')[];
  padded?: boolean;
  refreshControl?: ComponentProps<typeof ScrollView>['refreshControl'];
  /** A tab screen: leaves room for the floating tab bar. */
  tab?: boolean;
  backdrop?: boolean;
}) {
  const t = useTheme();
  const inner = padded ? { paddingHorizontal: space.lg } : null;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {backdrop ? <Backdrop /> : null}
      <SafeAreaView edges={edges} style={{ flex: 1 }}>
        {scroll ? (
          <ScrollView contentContainerStyle={[inner, { paddingBottom: tab ? TAB_BAR_SPACE + space.lg : space.xxl }]} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, inner]}>{children}</View>
        )}
      </SafeAreaView>
    </View>
  );
}

export function Card({ children, style, onPress, accessibilityLabel, tint }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string; tint?: string | null }) {
  return (
    <Glass style={style} onPress={onPress} accessibilityLabel={accessibilityLabel} tint={tint}>
      {children}
    </Glass>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  loading,
  style,
  color,
}: {
  title: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  color?: string;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? color ?? t.brand : kind === 'danger' ? t.live : kind === 'secondary' ? t.glass : 'transparent';
  const fg = kind === 'primary' ? t.brandText : kind === 'danger' ? '#fff' : kind === 'ghost' ? t.brand : t.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? t.glassBorder : 'transparent', opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} color={fg} size={20} /> : null}
      <Text v="h3" color={fg} style={{ fontSize: 15 }}>
        {title}
      </Text>
    </Pressable>
  );
}

export const Chip = memo(function Chip({ label, selected, onPress, color, icon, disabled, badge, left }: { label: string; selected?: boolean; onPress?: () => void; color?: string; icon?: string; disabled?: boolean; badge?: string; left?: ReactNode }) {
  const t = useTheme();
  const accent = color ?? t.brand;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: selected ? accent : t.glassBorder, backgroundColor: selected ? alpha(accent, 0.2) : t.glass, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
      ]}
    >
      {left ?? null}
      {icon ? <Icon name={icon} size={18} color={selected ? accent : t.textDim} /> : null}
      <Text v="small" style={{ fontWeight: selected ? '700' : '500' }} color={selected ? t.text : t.textDim}>
        {label}
      </Text>
      {badge ? (
        <Text v="tiny" muted>
          {badge}
        </Text>
      ) : null}
    </Pressable>
  );
});

export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: space.xs }}>
      {children}
    </ScrollView>
  );
}

export function Segmented<T extends string>({ options, value, onChange, scroll }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; scroll?: boolean }) {
  const t = useTheme();
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.lg, paddingVertical: space.xs }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={{ minHeight: 40, justifyContent: 'center' }}>
              <Text v="h3" color={on ? t.brand : t.textDim} style={{ fontWeight: on ? '800' : '600' }}>
                {o.label}
              </Text>
              <View style={{ height: 3, borderRadius: 2, marginTop: 4, backgroundColor: on ? t.brand : 'transparent', width: 24, alignSelf: 'center' }} />
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }
  return (
    <View style={[styles.segmented, { backgroundColor: t.glass, borderColor: t.glassBorder }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && { backgroundColor: alpha(t.brand, 0.18), borderColor: alpha(t.brand, 0.6), borderWidth: 1 }]}
          >
            <Text v="small" style={{ fontWeight: on ? '800' : '500' }} dim={!on}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionHeader({ title, action, onAction, icon, color }: { title: string; action?: string; onAction?: () => void; icon?: string; color?: string }) {
  const t = useTheme();
  return (
    <View style={styles.sectionHeader}>
      {icon ? <Icon name={icon} size={18} color={color ?? t.textDim} /> : null}
      <Text v="label" dim style={{ flex: 1 }}>
        {title}
      </Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button">
          <Text v="small" color={t.brand} style={{ fontWeight: '700' }}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={t.brand} size="large" />
      {label ? (
        <Text dim style={{ marginTop: space.md }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export function EmptyState({ icon = 'calendar-blank', title, body, action, onAction }: { icon?: string; title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={[styles.center, { paddingVertical: space.xxl }]}>
      <Icon name={icon} size={40} />
      <Text v="h3" style={{ marginTop: space.md, textAlign: 'center' }}>
        {title}
      </Text>
      {body ? (
        <Text dim style={{ marginTop: space.xs, textAlign: 'center', maxWidth: 320 }}>
          {body}
        </Text>
      ) : null}
      {action ? <Button title={action} onPress={onAction} kind="secondary" style={{ marginTop: space.lg }} /> : null}
    </View>
  );
}

/** Shown when we're rendering cached data because the network failed. */
export function StatusBanner({ error, offline, updatedAt, onRetry }: { error?: string; offline?: boolean; updatedAt?: number; onRetry?: () => void }) {
  const t = useTheme();
  if (!error) return null;
  const when = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <Pressable onPress={onRetry} accessibilityRole="button" style={[styles.banner, { backgroundColor: t.pending + '22', borderColor: t.pending }]}>
      <Icon name={offline ? 'wifi-off' : 'alert-circle-outline'} color={t.pending} />
      <Text v="small" style={{ flex: 1 }}>
        {offline ? "You're offline" : error}
        {when ? ` · showing data from ${when}` : ''}
      </Text>
      <Text v="small" color={t.pending} style={{ fontWeight: '700' }}>
        Retry
      </Text>
    </Pressable>
  );
}

export function Disclaimer({ compact }: { compact?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.disclaimer, { borderColor: t.border }]}>
      <Icon name="information-outline" size={16} color={t.textMuted} />
      <Text v="tiny" muted style={{ flex: 1 }}>
        {compact
          ? 'For information & entertainment only. Not betting advice. Free to play, no real money.'
          : 'Predictions are for information and entertainment only and are not betting advice. The pick game is free to play: no real-money stakes or prizes.'}
      </Text>
    </View>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function StatTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: t.glass, borderColor: t.glassBorder }]}>
      <Text v="tiny" muted style={{ fontWeight: '700', textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text v="h2" color={color} style={{ marginTop: 2 }}>
        {value}
      </Text>
      {sub ? (
        <Text v="tiny" dim>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  button: { minHeight: TAP, borderRadius: radius.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, borderWidth: 1 },
  chip: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3, borderWidth: StyleSheet.hairlineWidth },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xl, marginBottom: space.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, marginVertical: space.sm, minHeight: TAP },
  disclaimer: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', paddingVertical: space.md, marginTop: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  stat: { flex: 1, minWidth: 96, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
});
