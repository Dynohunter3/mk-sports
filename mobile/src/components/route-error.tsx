import { type ErrorBoundaryProps, router } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';

import { Button, Icon, Text } from '@/components/ui';
import { space, useTheme } from '@/theme/theme';

function canGoBack() {
  try {
    return router.canGoBack();
  } catch {
    return false;
  }
}

/**
 * Shown in place of a screen that crashed while drawing (bad data from a feed, an unexpected missing field), so one
 * broken screen does not take the whole app down. Each route re-exports it as `ErrorBoundary` (expo-router's
 * convention); the root layout's copy is the last resort. Nothing is sent anywhere: the error is only logged.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const t = useTheme();
  useEffect(() => console.warn('screen error:', error), [error]);
  const back = canGoBack();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md }} accessibilityRole="alert">
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.glass, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="alert-circle-outline" size={34} color={t.textDim} />
      </View>
      <Text v="h2" style={{ textAlign: 'center' }}>
        This screen hit a problem
      </Text>
      <Text dim style={{ textAlign: 'center', maxWidth: 320 }}>
        Something in the data didn't look as expected. The rest of the app still works, and your picks are safe.
      </Text>
      {error?.message ? (
        <Text v="tiny" muted style={{ textAlign: 'center', maxWidth: 320 }} numberOfLines={3} selectable>
          {error.message}
        </Text>
      ) : null}
      <View style={{ alignSelf: 'stretch', gap: space.sm, marginTop: space.sm, maxWidth: 360, width: '100%', marginHorizontal: 'auto' }}>
        <Button title="Try again" icon="refresh" onPress={() => void retry()} />
        {back ? <Button title="Go back" kind="secondary" onPress={() => router.back()} /> : null}
      </View>
    </View>
  );
}
