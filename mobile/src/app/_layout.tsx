import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/auth/auth';
import { useAlerts } from '@/notify/useAlerts';
import { PrefsProvider, usePrefs } from '@/state/prefs';
import { ThemeProvider, useTheme } from '@/theme/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Navigator() {
  const t = useTheme();
  const { ready: prefsReady } = usePrefs();
  const { ready: authReady } = useAuth();
  const ready = prefsReady && authReady;
  useAlerts(ready);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  const navTheme = useMemo(() => {
    const base = t.mode === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: t.bg, card: t.bg, text: t.text, border: t.border, primary: t.brand } };
  }, [t]);

  if (!ready) return null;
  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={t.mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.text,
          headerShadowVisible: false,
          headerBackTitle: 'Back',
          contentStyle: { backgroundColor: t.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="match/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="team/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="player/[id]" options={{ headerShown: false, presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="league/[id]" options={{ title: 'League' }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="leaderboard" options={{ title: 'My points' }} />
        <Stack.Screen name="pick/[id]" options={{ title: 'Make your pick', presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="sign-in" options={{ title: 'Sign in', presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="accuracy" options={{ title: 'Model accuracy' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="private-leagues" options={{ title: 'Private leagues' }} />
      </Stack>
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PrefsProvider>
        <ThemeProvider>
          <AuthProvider>
            <Navigator />
          </AuthProvider>
        </ThemeProvider>
      </PrefsProvider>
    </SafeAreaProvider>
  );
}
