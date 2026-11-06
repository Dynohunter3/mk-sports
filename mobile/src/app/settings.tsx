import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, Switch, TextInput, View } from 'react-native';

import { invalidate } from '@/api/cache';
import { api, API_URL } from '@/api/client';
import type { Me } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { Button, Card, Disclaimer, Icon, Row, SectionHeader, Segmented, Text } from '@/components/ui';
import { confirm, notify } from '@/lib/dialogs';
import { NOTIFY_SUPPORTED, requestPermission } from '@/notify/notifications';
import { usePrefs } from '@/state/prefs';
import { radius, space, TAP, useTheme } from '@/theme/theme';

function Item({ icon, title, sub, right, onPress, danger }: { icon: string; title: string; sub?: string; right?: ReactNode; onPress?: () => void; danger?: boolean }) {
  const t = useTheme();
  const body = (
    <Row style={{ minHeight: TAP + 8, paddingVertical: 6 }} gap={space.md}>
      <Icon name={icon} color={danger ? t.loss : t.textDim} />
      <View style={{ flex: 1 }}>
        <Text color={danger ? t.loss : undefined}>{title}</Text>
        {sub ? (
          <Text v="tiny" muted>
            {sub}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron-right" /> : null)}
    </Row>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

const NOTIFS: { key: string; title: string; sub: string }[] = [
  { key: 'match_reminders', title: 'Match reminders', sub: 'Before your favourite teams play' },
  { key: 'pick_lock_warnings', title: 'Pick-lock warnings', sub: '30 minutes before a match you haven’t picked locks' },
  { key: 'results', title: 'Results', sub: 'When your picks are settled' },
  { key: 'leaderboard', title: 'Leaderboard changes', sub: 'When you move up or down' },
];

export default function Settings() {
  const { prefs: p0, update: up0 } = usePrefs();
  const setNotify = async (patch: Partial<typeof p0.notify>) => {
    const turningOn = Object.values(patch).some(Boolean);
    if (turningOn && !(await requestPermission())) {
      const again = await confirm('Notifications are off', 'Allow notifications for MK Sports in your phone settings, then turn this on again.', 'Open settings');
      if (again) Linking.openSettings().catch(() => undefined);
      return;
    }
    up0({ notify: { ...p0.notify, ...patch } });
  };
  const t = useTheme();
  const { prefs, update } = usePrefs();
  const auth = useAuth();
  const me = auth.me;
  const [name, setName] = useState(me?.display_name ?? '');
  const [savingName, setSavingName] = useState(false);

  async function setNotif(key: string, value: boolean) {
    await api<Me>('/me', { method: 'PATCH', body: { notification_prefs: { [key]: value } } }).catch(() => notify('Could not save', 'Check your connection and try again.'));
    await auth.refreshMe();
  }

  async function exportData() {
    try {
      const data = await api<unknown>('/me/export');
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'predictpro-data.json';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ message: json, title: 'My MK Sports data' });
      }
    } catch {
      notify('Export failed', 'Check your connection and try again.');
    }
  }

  async function deleteAccount() {
    const device = auth.mode === 'device';
    const ok = await confirm(
      device ? 'Delete your data?' : 'Delete account?',
      device ? 'This removes your picks, points, badges and saved forecasts from this phone. This cannot be undone.' : 'This permanently deletes your account, picks, points and badges. This cannot be undone.',
      'Delete',
      true,
    );
    if (!ok) return;
    try {
      await auth.deleteAccount();
      notify(device ? 'Data deleted' : 'Account deleted', device ? 'Your picks, points and badges have been removed from this phone.' : 'Your account and data have been removed.');
      router.replace('/');
    } catch {
      notify('Could not delete account', 'Please try again.');
    }
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}>
      <SectionHeader title="Personalisation" />
      <Card style={{ paddingVertical: 4 }}>
        <Item icon="shield-star-outline" title="My team" sub={prefs.favoriteTeam ? prefs.favoriteTeam.name : 'Not chosen yet'} onPress={() => router.navigate('/team')} />
        <Item icon="star-outline" title="Favourite sports & competitions" sub={`${prefs.sports.length} sports · ${prefs.leagues.length} competitions`} onPress={() => router.push('/onboarding')} />
      </Card>

      <SectionHeader title="Notifications" />
      <Card style={{ gap: space.sm }}>
        {NOTIFY_SUPPORTED ? (
          <>
            <Text v="small" dim>
              For {prefs.favoriteTeam ? prefs.favoriteTeam.name : 'your team'}, matches you've picked and matches you follow with the bell. Reminders arrive on time. Goal and result alerts are instant while the app is open; in the background Android checks about every 15 minutes, so they can arrive a little late.
            </Text>
            <Item icon="soccer" title="Goals, kick-off & full time" right={<Switch value={prefs.notify.matchAlerts} onValueChange={(v) => setNotify({ matchAlerts: v })} accessibilityLabel="Goal and result alerts" />} />
            <Item icon="alarm" title="Kick-off reminders (30 min before)" right={<Switch value={prefs.notify.reminders} onValueChange={(v) => setNotify({ reminders: v })} accessibilityLabel="Kick-off reminders" />} />
            <Item icon="hand-pointing-right" title="Pick results & points" right={<Switch value={prefs.notify.pickResults} onValueChange={(v) => setNotify({ pickResults: v })} accessibilityLabel="Pick results" />} />
          </>
        ) : (
          <Text v="small" dim>
            Notifications are available in the Android app.
          </Text>
        )}
      </Card>

      <SectionHeader title="Appearance & data" />
      <Card style={{ gap: space.md }}>
        <Segmented
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
          value={prefs.theme}
          onChange={(v) => update({ theme: v })}
        />
        <Item icon="signal-cellular-1" title="Data saver" sub="Pause automatic refreshing. Pull down to refresh manually." right={<Switch value={prefs.dataSaver} onValueChange={(v) => update({ dataSaver: v })} accessibilityLabel="Data saver" />} />
        <Item icon="robot-outline" title="Show AI prediction when picking" right={<Switch value={prefs.showAiOnPickScreen} onValueChange={(v) => update({ showAiOnPickScreen: v })} accessibilityLabel="Show AI prediction when picking" />} />
      </Card>

      <SectionHeader title="Data sources" />
      <Card style={{ gap: space.sm }}>
        <Text v="small" dim>
          Fixtures, live scores, line-ups, match and player stats, tables, team news and headlines come from ESPN's public sports feed; crests and photos from its image service. Forecasts blend the MK Sports model with ESPN Analytics' matchup predictor and betting-market consensus where available, weighted by how accurate each has been on past matches. xG is MK Sports' own estimate from shot positions.
        </Text>
        <Item
          icon="scale-balance"
          title="Include betting-market consensus"
          sub="Usually the most accurate public signal. Prices are converted to probabilities; odds are never shown."
          right={
            <Switch
              value={prefs.useMarket}
              onValueChange={(v) => {
                update({ useMarket: v });
                invalidate();
              }}
              accessibilityLabel="Include betting-market consensus"
            />
          }
        />
        <Item icon="chart-bell-curve" title="Accuracy of each source" onPress={() => router.push('/accuracy')} />
      </Card>

      {me ? (
        <>
          {auth.mode !== 'device' ? (
          <>
          <SectionHeader title="Notifications" />
          <Card style={{ paddingVertical: 4 }}>
            <Text v="tiny" muted style={{ marginTop: space.sm }}>
              Saved to your account. Push delivery (Firebase Cloud Messaging) arrives in Phase 2.
            </Text>
            {NOTIFS.map((n) => (
              <Item key={n.key} icon="bell-outline" title={n.title} sub={n.sub} right={<Switch value={!!me.notification_prefs[n.key]} onValueChange={(v) => setNotif(n.key, v)} accessibilityLabel={n.title} />} />
            ))}
          </Card>
          </>
          ) : null}

          <SectionHeader title={auth.mode === 'device' ? 'Profile' : 'Account'} />
          <Card style={{ gap: space.sm }}>
            <Text v="small" dim>
              Display name (shown on leaderboards)
            </Text>
            <Row>
              <TextInput
                value={name}
                onChangeText={setName}
                maxLength={40}
                style={{ flex: 1, minHeight: TAP, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, color: t.text, paddingHorizontal: space.md, backgroundColor: t.surface2 }}
                accessibilityLabel="Display name"
              />
              <Button
                title="Save"
                kind="secondary"
                disabled={name.trim().length < 2 || name === me.display_name}
                loading={savingName}
                onPress={async () => {
                  setSavingName(true);
                  await api('/me', { method: 'PATCH', body: { display_name: name.trim() } }).catch(() => notify('Could not save name'));
                  await auth.refreshMe();
                  setSavingName(false);
                }}
              />
            </Row>
            {auth.mode === 'device' ? (
              <Text v="tiny" muted>
                No account needed: your profile, picks and points are stored only on this phone.
              </Text>
            ) : (
              <>
                <Text v="tiny" muted>
                  Signed in with {me.auth_provider === 'dev' ? 'email' : 'Supabase'} · {me.email ?? me.phone}
                </Text>
                <Item icon="logout" title="Sign out" onPress={auth.signOut} />
              </>
            )}
          </Card>

          <SectionHeader title="Privacy" />
          <Card style={{ paddingVertical: 4 }}>
            <Item icon="download-outline" title="Export my data" sub="Everything we hold about you, as JSON" onPress={exportData} />
            {auth.mode === 'device' ? (
              <Item icon="delete-outline" title="Delete my data" sub="Removes your picks, points, badges and saved forecasts from this phone" onPress={deleteAccount} danger />
            ) : (
              <Item icon="delete-outline" title="Delete my account" sub="Removes your account and all associated data" onPress={deleteAccount} danger />
            )}
          </Card>
        </>
      ) : (
        <>
          <SectionHeader title="Account" />
          <Button title="Sign in or create account" icon="login" onPress={() => router.push('/sign-in')} />
        </>
      )}

      <SectionHeader title="About & responsible use" />
      <Card style={{ gap: space.sm }}>
        <Text v="small">MK Sports predictions are produced by statistical models and are for information and entertainment only. They are not betting advice and no outcome is guaranteed.</Text>
        <Text v="small">The pick game is free to play: there are no real-money stakes, entry fees or cash prizes. MK Sports does not show bookmaker odds; if it ever does, an 18+ age check and responsible-gambling resources will be added first.</Text>
        <Text v="small">If gambling is affecting you or someone you know, seek support from a local responsible-gambling organisation.</Text>
        <Item icon="chart-bell-curve" title="How accurate is the model?" onPress={() => router.push('/accuracy')} />
        <Text v="tiny" muted>
          MK Sports {Constants.expoConfig?.version ?? ''} · {auth.mode === 'device' ? 'on-device data mode' : `API ${API_URL}`}
        </Text>
      </Card>
      <Disclaimer />
    </ScrollView>
  );
}
