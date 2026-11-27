import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, Share, Switch, View } from 'react-native';

import { ProfileEditor } from '@/components/profile';
import { BackupError, makeBackup, parseBackup, restoreBackup, summary as backupSummary } from '@/data/backup';
import { CONTACT } from '@/data/contact';
import { PHOTO_CREDITS_URL } from '@/data/photos';
import { SITE } from '@/data/pleagues';

import { invalidate } from '@/api/cache';
import { api, API_URL } from '@/api/client';
import type { Me } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { Button, Card, Disclaimer, Icon, Row, SectionHeader, Segmented, Text } from '@/components/ui';
import { confirm, notify } from '@/lib/dialogs';
import { startLiveTracking } from '@/notify/live';
import { NOTIFY_SUPPORTED, requestPermission, sendTestAlerts } from '@/notify/notifications';
import { usePrefs } from '@/state/prefs';
import { space, TAP, useTheme } from '@/theme/theme';

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

  async function setNotif(key: string, value: boolean) {
    await api<Me>('/me', { method: 'PATCH', body: { notification_prefs: { [key]: value } } }).catch(() => notify('Could not save', 'Check your connection and try again.'));
    await auth.refreshMe();
  }

  async function exportData() {
    try {
      if (auth.mode !== 'device') {
        // server mode: the account's data, as before
        const json = JSON.stringify(await api<unknown>('/me/export'), null, 2);
        await Share.share({ message: json, title: 'My MK Sports data' });
        return;
      }
      const json = JSON.stringify(await makeBackup(prefs as unknown as Record<string, unknown>), null, 1);
      const name = `mk-sports-backup-${new Date().toISOString().slice(0, 10)}.json`;
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const { File, Paths } = await import('expo-file-system');
      const Sharing = await import('expo-sharing');
      const f = new File(Paths.cache, name);
      if (f.exists) f.delete();
      f.create();
      f.write(json);
      await Sharing.shareAsync(f.uri, { mimeType: 'application/json', dialogTitle: 'Save your MK Sports backup', UTI: 'public.json' });
    } catch {
      notify('Backup failed', 'Please try again.');
    }
  }

  async function importData() {
    try {
      const DocumentPicker = await import('expo-document-picker');
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', 'application/octet-stream', '*/*'], copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      let text: string;
      if (Platform.OS === 'web') text = await (await fetch(res.assets[0].uri)).text();
      else {
        const { File } = await import('expo-file-system');
        text = await new File(res.assets[0].uri).text();
      }
      const b = parseBackup(text);
      const s = backupSummary(b);
      const when = s.date ? ` from ${new Date(s.date).toLocaleDateString()}` : '';
      const ok = await confirm(
        `Restore this backup${when}?`,
        `It has ${s.picks} ${s.picks === 1 ? 'pick' : 'picks'}, ${s.leagues} private ${s.leagues === 1 ? 'league' : 'leagues'}${s.settings ? ' and your settings' : ''}. It replaces what is on this phone now.`,
        'Restore',
      );
      if (!ok) return;
      const restored = await restoreBackup(b);
      if (restored) update(restored as never);
      invalidate(() => true);
      await auth.refreshMe();
      notify('Backup restored', `${s.picks} ${s.picks === 1 ? 'pick' : 'picks'} and ${s.leagues} ${s.leagues === 1 ? 'league' : 'leagues'} are back.`);
    } catch (e) {
      notify('Could not restore', e instanceof BackupError ? e.message : 'That file could not be read.');
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
              For {prefs.favoriteTeam ? prefs.favoriteTeam.name : 'your team'}, matches you've picked and matches you follow with the bell. Reminders and kick-off alerts are scheduled for the exact time. During your matches, live tracking checks every 30 seconds for goals and full time.
            </Text>
            <Item icon="soccer" title="Goals, kick-off & full time" right={<Switch value={prefs.notify.matchAlerts} onValueChange={(v) => setNotify({ matchAlerts: v })} accessibilityLabel="Goal and result alerts" />} />
            {Platform.OS === 'android' ? (
              <Item
                icon="access-point"
                title="Live tracking during your matches"
                sub="A live-score notification while your matches are on; goal and full-time alerts within about 30 seconds. Starts when you open the app during a match (the kick-off alert is a handy way in)."
                right={<Switch value={prefs.notify.matchAlerts && prefs.notify.liveTracking !== false} disabled={!prefs.notify.matchAlerts} onValueChange={(v) => setNotify({ liveTracking: v })} accessibilityLabel="Live tracking" />}
              />
            ) : null}
            <Item icon="alarm" title="Kick-off reminders (30 min before)" right={<Switch value={prefs.notify.reminders} onValueChange={(v) => setNotify({ reminders: v })} accessibilityLabel="Kick-off reminders" />} />
            <Item icon="hand-pointing-right" title="Pick results & points" right={<Switch value={prefs.notify.pickResults} onValueChange={(v) => setNotify({ pickResults: v })} accessibilityLabel="Pick results" />} />
            {Platform.OS === 'android' ? (
              <Item
                icon="widgets-outline"
                title="Add the My team widget"
                sub="Your team's live score or next match on your home screen"
                onPress={async () => {
                  try {
                    const { requestPinWidget } = await import('react-native-android-widget');
                    const ok = await requestPinWidget({ widgetName: 'MyTeam' });
                    if (!ok) notify('Add it from your home screen', 'Long-press an empty spot on your home screen, choose Widgets, then find MK Sports.');
                  } catch {
                    notify('Add it from your home screen', 'Long-press an empty spot on your home screen, choose Widgets, then find MK Sports.');
                  }
                }}
              />
            ) : null}
            <Item
              icon="bell-ring-outline"
              title="Test my alerts"
              sub="Sends one alert now and one in exactly a minute"
              onPress={async () => {
                const ok = await sendTestAlerts();
                if (!ok) notify('Notifications are off', 'Allow notifications for MK Sports in your phone settings, then try again.');
                else if (Platform.OS === 'android' && prefs.notify.matchAlerts && prefs.notify.liveTracking !== false) startLiveTracking().catch(() => undefined); // shows the live-tracking notification for a moment
              }}
            />
            {Platform.OS === 'android' ? (
              <Item
                icon="battery-heart-variant"
                title="Alerts late or missing?"
                sub="Let MK Sports run in the background"
                onPress={() =>
                  confirm(
                    'Keep alerts on time',
                    "Some phones pause apps to save battery, which delays alerts. In the next screen open Battery and choose 'Unrestricted' (or turn off battery optimisation). On Tecno, Infinix and itel phones also allow Auto-start in Phone Master; on Xiaomi, allow Autostart.",
                    'Open settings',
                  ).then((go) => {
                    if (go) Linking.openSettings().catch(() => undefined);
                  })
                }
              />
            ) : null}
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
        <Item icon="animation-play-outline" title="Animations" sub="Springy taps, confetti and moving cards. Also follows the phone's reduce-motion setting." right={<Switch value={prefs.motion !== false} onValueChange={(v) => update({ motion: v })} accessibilityLabel="Animations" />} />
        {Platform.OS !== 'web' ? (
          <Item icon="vibrate" title="Vibration" sub="A light buzz on taps, picks and celebrations." right={<Switch value={prefs.haptics !== false} onValueChange={(v) => update({ haptics: v })} accessibilityLabel="Vibration" />} />
        ) : null}
      </Card>

      <SectionHeader title="Data sources" />
      <Card style={{ gap: space.sm }}>
        <Text v="small" dim>
          Football forecasts for the Premier League, Championship, LaLiga, Serie A, Bundesliga, Ligue 1, Eredivisie, Liga Portugal, Süper Lig, MLS and the Champions League come from the MK Sports model, published daily and graded after every match. Football data: football-data.co.uk and openfootball (public domain). Fixtures, live scores, line-ups, match and player stats, tables, team news and headlines still come from ESPN's public sports feed, as do forecasts for other competitions and sports, and crests and photos. xG in the match centre is MK Sports' own estimate from shot positions.
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
              Your name and avatar (shown in private leagues)
            </Text>
            <ProfileEditor me={me} />
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
            <Item icon="download-outline" title={auth.mode === 'device' ? 'Back up my data' : 'Export my data'} sub={auth.mode === 'device' ? 'Picks, points, badges, leagues and settings, as a file you keep' : 'Everything we hold about you, as JSON'} onPress={exportData} />
            {auth.mode === 'device' ? <Item icon="upload-outline" title="Restore from a backup" sub="On a new phone, or after reinstalling" onPress={importData} /> : null}
            {auth.mode === 'device' ? (
              <Item icon="delete-outline" title="Delete my data" sub="Removes your picks, points, badges and saved forecasts from this phone" onPress={deleteAccount} danger />
            ) : (
              <Item icon="delete-outline" title="Delete my account" sub="Removes your account and all associated data" onPress={deleteAccount} danger />
            )}
          </Card>
          {auth.mode === 'device' ? (
            <Text v="tiny" muted style={{ marginTop: space.sm, marginHorizontal: space.xs }}>
              Android also backs up MK Sports to your Google account when backup is on in your phone's settings, and restores it when you reinstall or set up a new phone. A backup file is the sure way to move your picks and leagues yourself.
            </Text>
          ) : null}
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
        <Item icon="image-multiple-outline" title="Player photo credits" sub="Wikimedia Commons photographers, free licences" onPress={() => Linking.openURL(PHOTO_CREDITS_URL).catch(() => notify(PHOTO_CREDITS_URL))} />
      </Card>

      <SectionHeader title="Contact us" icon="card-account-phone-outline" />
      <Card style={{ paddingVertical: 4 }}>
        <Item icon="email-outline" title="Email" sub={CONTACT.email} onPress={() => Linking.openURL(`mailto:${CONTACT.email}?subject=${encodeURIComponent('MK Sports')}`).catch(() => notify(CONTACT.email))} />
        <Item icon="phone-outline" title="Call" sub={CONTACT.phoneLabel} onPress={() => Linking.openURL(`tel:${CONTACT.phone}`).catch(() => notify(CONTACT.phoneLabel))} />
        <Item icon="whatsapp" title="WhatsApp" sub={CONTACT.whatsappLabel} onPress={() => Linking.openURL(`https://wa.me/${CONTACT.whatsapp.replace('+', '')}`).catch(() => notify(CONTACT.whatsappLabel))} />
        <Item
          icon="share-variant"
          title="Share MK Sports"
          sub="Send friends the download link"
          onPress={() => Share.share({ message: `Join me on MK Sports: live scores, AI predictions and a free game where you try to beat the AI. Download for Android: ${SITE}/` }).catch(() => undefined)}
        />
      </Card>
      <Card style={{ marginTop: space.sm }}>
        <Text v="tiny" muted>
          MK Sports {Constants.expoConfig?.version ?? ''} · {auth.mode === 'device' ? 'on-device data mode' : `API ${API_URL}`}
        </Text>
      </Card>
      <Disclaimer />
    </ScrollView>
  );
}

export { ErrorBoundary } from '@/components/route-error';
