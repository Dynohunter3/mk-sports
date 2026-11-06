import { ScrollView } from 'react-native';

import { Button, Card, Icon, Row, Text } from '@/components/ui';
import { space, useTheme } from '@/theme/theme';

/** Phase 2: the data model (private_leagues, private_league_members) and leaderboard scopes
 * are already in place; this screen previews the feature. */
export default function PrivateLeagues() {
  const t = useTheme();
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Card style={{ alignItems: 'center', gap: space.md }}>
        <Icon name="shield-account" size={48} color={t.brand} />
        <Text v="h2" style={{ textAlign: 'center' }}>
          Private leagues are coming
        </Text>
        <Text dim style={{ textAlign: 'center' }}>
          Create a league for your friends, workplace or fan club, share an invite code and compete on your own weekly and season leaderboards.
        </Text>
      </Card>
      {[
        ['account-multiple-plus', 'Invite with a code', 'Share a 6-character code or link on WhatsApp.'],
        ['soccer', 'Choose the sports', 'All sports, or just football or basketball.'],
        ['podium', 'Your own leaderboards', 'Weekly and season tables, using the same points as the global game.'],
      ].map(([icon, title, body]) => (
        <Row key={title} style={{ alignItems: 'flex-start' }} gap={space.md}>
          <Icon name={icon} size={24} color={t.brand} />
          <Text style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>{title}. </Text>
            <Text dim>{body}</Text>
          </Text>
        </Row>
      ))}
      <Button title="Create a league" disabled icon="plus" />
      <Button title="Join with a code" kind="secondary" disabled icon="ticket-confirmation-outline" />
      <Text v="tiny" muted style={{ textAlign: 'center' }}>
        Arriving in Phase 2 together with notifications, cricket and tennis.
      </Text>
    </ScrollView>
  );
}
