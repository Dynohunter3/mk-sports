import { Redirect, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Crest } from '@/components/crest';
import { GlassBar } from '@/components/glass';
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
function GlassTabBar({ state, navigateToTab }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { prefs } = usePrefs();
  const fav = prefs.favoriteTeam;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingBottom: Math.max(insets.bottom, 10) }}>
      <GlassBar>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 68, paddingHorizontal: 4 }}>
          {state.routes.map((route, i) => {
            const tab = TABS.find((x) => x.name === route.name);
            if (!tab) return null;
            const on = state.index === i;
            const go = () => {
              if (!on) navigateToTab(route.key);
            };
            const center = tab.name === 'team';
            const color = on ? t.brand : t.textMuted;
            const glow = on ? { textShadowColor: alpha(t.brand, 0.55), textShadowRadius: 8 } : null;
            return (
              <Pressable key={route.key} onPress={go} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={tab.title} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', height: 68 }}>
                {/* same-height icon slot for every tab, so icons, crest and labels share one line */}
                <View style={{ height: ICON_SLOT, alignItems: 'center', justifyContent: 'center' }}>
                  {center ? (
                    fav ? (
                      <Crest team={{ code: fav.code, color: fav.color, logo: fav.logo }} size={ICON_SLOT} />
                    ) : (
                      <Icon name={on ? 'shield-star' : 'shield-plus-outline'} size={28} color={color} style={glow} />
                    )
                  ) : (
                    <Icon name={on ? tab.iconOn : tab.icon} size={26} color={color} style={glow} />
                  )}
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
