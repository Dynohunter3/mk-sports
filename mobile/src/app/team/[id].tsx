import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TeamHubView } from '@/components/teamhub';
import { LeagueTheme, useTheme } from '@/theme/theme';

export default function TeamScreen() {
  const { id, league } = useLocalSearchParams<{ id: string; league?: string }>();
  const t = useTheme();
  return (
    <LeagueTheme league={league ?? null}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <TeamHubView id={id} leagues={league ? [league] : undefined} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </SafeAreaView>
      </View>
    </LeagueTheme>
  );
}
