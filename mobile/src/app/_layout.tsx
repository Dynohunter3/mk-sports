import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/auth/auth';
import { setFeedback } from '@/components/motion';
import { useAlerts } from '@/notify/useAlerts';
import { PrefsProvider, usePrefs } from '@/state/prefs';
import { FONT_FILES } from '@/theme/fonts';
import { ThemeProvider, useTheme } from '@/theme/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Navigator() {
  const t = useTheme();
  const { ready: prefsReady, prefs } = usePrefs();
  const { ready: authReady } = useAuth();
  // the display face; if it fails to load, text falls back to the system font rather than blocking the app
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  const ready = prefsReady && authReady && (fontsLoaded || !!fontError);
  useEffect(() => setFeedback({ haptics: prefs.haptics !== false, motion: prefs.motion !== false }), [prefs.haptics, prefs.motion]);
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
        <Stack.Screen name="leaderboard" options={{ headerShown: false }} />
        <Stack.Screen name="pick/[id]" options={{ title: 'Make your pick', presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="f1-pick" options={{ title: 'Predict the podium', presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="tennis-pick" options={{ title: 'Tennis pick', presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="recap" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ title: 'Sign in', presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="accuracy" options={{ title: 'Model accuracy' }} />
        <Stack.Screen name="predictions" options={{ title: 'Predictions' }} />
        <Stack.Screen name="play" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="private-leagues" options={{ headerShown: false }} />
        <Stack.Screen name="pl" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="search" options={{ headerShown: false, animation: 'fade' }} />
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
