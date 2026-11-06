import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Backdrop } from '@/components/glass';
import { TeamHubView, TeamPicker } from '@/components/teamhub';
import { usePrefs } from '@/state/prefs';
import { LeagueTheme, useTheme } from '@/theme/theme';

export default function MyTeamScreen() {
  const t = useTheme();
  const { prefs, update } = usePrefs();
  const fav = prefs.favoriteTeam;
  return (
    <LeagueTheme league={fav?.leagues[0] ?? null}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Backdrop />
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          {fav ? (
            <TeamHubView id={fav.id} leagues={fav.leagues} tab />
          ) : (
            <TeamPicker onPick={(f) => update({ favoriteTeam: f, leagues: [...new Set([...prefs.leagues, ...f.leagues])], sports: [...new Set([...prefs.sports, f.sport])] })} />
          )}
        </SafeAreaView>
      </View>
    </LeagueTheme>
  );
}
