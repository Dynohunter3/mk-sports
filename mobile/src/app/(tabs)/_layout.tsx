import { Redirect, Tabs } from 'expo-router';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Crest } from '@/components/crest';
import { GlassBar } from '@/components/glass';
import { haptic, motionEnabled } from '@/components/motion';
import { Icon, Text } from '@/components/ui';
import { usePrefs } from '@/state/prefs';
import { alpha, useTheme } from '@/theme/theme';

const ICON_SLOT = 34;

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const TABS: { name: string; title: string; icon: string; iconOn: string }[] = [
  { name: 'index', title: 'Home', icon: 'home-variant-outline', iconOn: 'home-variant' },
  { name: 'sports', title: 'Scores', icon: 'scoreboard-outline', iconOn: 'scoreboard' },
  { name: 'team', title: 'My Team', icon: 'shield-star-outline', iconOn: 'shield-star' },
  { name: 'news', title: 'News', icon: 'newspaper-variant-outline', iconOn: 'newspaper-variant' },
  { name: 'stats', title: 'Stats', icon: 'chart-box-outline', iconOn: 'chart-box' },
];

/** Floating glass tab bar; the middle tab is the user's team (its crest once chosen). */
/** The icon of the active tab pops when it is chosen. */
function TabIcon({ on, children }: { on: boolean; children: React.ReactNode }) {
  const s = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on || !motionEnabled()) return;
    s.setValue(0.7);
    Animated.spring(s, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 16 }).start();
  }, [on, s]);
  return <Animated.View style={{ transform: [{ scale: s }] }}>{children}</Animated.View>;
}

function GlassTabBar({ state, navigateToTab }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { prefs } = usePrefs();
  const fav = prefs.favoriteTeam;
  const n = state.routes.filter((r) => TABS.some((x) => x.name === r.name)).length || 1;
  const [w, setW] = useState(0);
  const slot = (w - 8) / n;
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!w) return;
    const to = 4 + state.index * slot;
    if (motionEnabled()) Animated.spring(x, { toValue: to, useNativeDriver: true, speed: 16, bounciness: 9 }).start();
    else x.setValue(to);
  }, [state.index, slot, w, x]);
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingBottom: Math.max(insets.bottom, 10) }}>
      <GlassBar>
        <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', alignItems: 'center', height: 68, paddingHorizontal: 4 }}>
          {w ? (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 0,
                top: 7,
                width: slot,
                height: 54,
                borderRadius: 18,
                backgroundColor: alpha(t.brand, 0.16),
                borderWidth: 1,
                borderColor: alpha(t.brand, 0.45),
                transform: [{ translateX: x }],
              }}
            />
          ) : null}
          {state.routes.map((route, i) => {
            const tab = TABS.find((x) => x.name === route.name);
            if (!tab) return null;
            const on = state.index === i;
            const go = () => {
              if (!on) {
                haptic.select();
                navigateToTab(route.key);
              }
            };
            const center = tab.name === 'team';
            const color = on ? t.brand : t.textMuted;
            const glow = on ? { textShadowColor: alpha(t.brand, 0.55), textShadowRadius: 8 } : null;
            return (
              <Pressable key={route.key} onPress={go} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={tab.title} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', height: 68 }}>
                {/* same-height icon slot for every tab, so icons, crest and labels share one line */}
                <View style={{ height: ICON_SLOT, alignItems: 'center', justifyContent: 'center' }}>
                  <TabIcon on={on}>
                  {center ? (
                    fav ? (
                      <Crest team={{ code: fav.code, color: fav.color, logo: fav.logo }} size={ICON_SLOT} />
                    ) : (
                      <Icon name={on ? 'shield-star' : 'shield-plus-outline'} size={28} color={color} style={glow} />
                    )
                  ) : (
                    <Icon name={on ? tab.iconOn : tab.icon} size={26} color={color} style={glow} />
                  )}
                  </TabIcon>
                </View>
                <Text v="tiny" style={[{ marginTop: 3, fontWeight: on ? '900' : '600', fontSize: 11 }, glow]} color={color} numberOfLines={1}>
                  {center && fav ? fav.code : tab.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </GlassBar>
    </View>
  );
}

export default function TabLayout() {
  const { prefs } = usePrefs();
  if (!prefs.onboarded) return <Redirect href="/onboarding" />;
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <GlassTabBar {...props} />}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title }} />
      ))}
    </Tabs>
  );
}

export { ErrorBoundary } from '@/components/route-error';
