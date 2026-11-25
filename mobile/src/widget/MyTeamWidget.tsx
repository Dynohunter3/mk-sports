/** The "My team" home-screen widget (react-native-android-widget primitives, not React Native views). */
import { FlexWidget, TextWidget } from 'react-native-android-widget';

import { onColor } from '@/theme/color';

import type { WidgetState, WidgetTeam } from './data';

const BG = '#0B1020';
const DIM = '#A6B3C6';

function Side({ t, align }: { t: WidgetTeam; align: 'left' | 'right' }) {
  return (
    <FlexWidget style={{ flex: 1, flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : 'flex-end' }}>
      <FlexWidget style={{ backgroundColor: t.color as `#${string}`, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
        <TextWidget text={t.code} style={{ fontSize: 18, fontWeight: 'bold', color: onColor(t.color) as `#${string}` }} />
      </FlexWidget>
      <TextWidget text={t.name} maxLines={1} style={{ fontSize: 12, color: DIM, marginTop: 4 }} />
    </FlexWidget>
  );
}

export function MyTeamWidget({ s }: { s: WidgetState }) {
  if (s.kind === 'none') {
    const msg = s.reason === 'no_team' ? 'Choose your team in MK Sports to see its next match here.' : s.reason === 'unsupported' ? 'Your team’s matches can’t be shown here yet.' : 'No match information right now. Tap to open MK Sports.';
    return (
      <FlexWidget clickAction="OPEN_APP" style={{ height: 'match_parent', width: 'match_parent', backgroundColor: BG, borderRadius: 18, padding: 14, justifyContent: 'center' }}>
        <TextWidget text="MK SPORTS" style={{ fontSize: 13, fontWeight: 'bold', color: '#2CF59A' }} />
        <TextWidget text={msg} maxLines={3} style={{ fontSize: 13, color: '#EEF3FA', marginTop: 4 }} />
      </FlexWidget>
    );
  }
  const live = s.kind === 'live';
  const middle = s.kind === 'next' ? 'v' : `${s.home.score ?? 0} – ${s.away.score ?? 0}`;
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: `mksports://match/${s.matchId}` }} style={{ height: 'match_parent', width: 'match_parent', backgroundColor: BG, borderRadius: 18, padding: 12, flexDirection: 'column', justifyContent: 'space-between' }}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TextWidget text={s.competition.toUpperCase()} maxLines={1} style={{ fontSize: 11, fontWeight: 'bold', color: DIM }} />
        <TextWidget text={live ? `● LIVE ${s.when}` : s.when} maxLines={1} style={{ fontSize: 11, fontWeight: 'bold', color: live ? '#FF4D5E' : DIM }} />
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
        <Side t={s.home} align="left" />
        <TextWidget text={middle} style={{ fontSize: s.kind === 'next' ? 18 : 26, fontWeight: 'bold', color: '#EEF3FA', marginHorizontal: 8 }} />
        <Side t={s.away} align="right" />
      </FlexWidget>
      <TextWidget text={s.last ?? (live ? 'Tap for the live match centre' : 'Tap for the match page')} maxLines={1} style={{ fontSize: 11, color: DIM }} />
    </FlexWidget>
  );
}
