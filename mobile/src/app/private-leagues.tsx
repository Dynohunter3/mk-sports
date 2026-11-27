/**
 * Private leagues: create a league, invite friends with a link or code, and compare points. Scores travel
 * in the links members share (see src/data/pleagues.ts): no account and no server needed.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Share, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { invalidate, useApi } from '@/api/cache';
import { api } from '@/api/client';
import type { PrivateLeague, PrivateLeagues } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { LeagueShareCard } from '@/components/cards';
import { Backdrop, Glass } from '@/components/glass';
import { ShareSheet } from '@/components/sharecard';
import { FadeIn, haptic, Pop, PressableScale } from '@/components/motion';
import { fieldStyle, ProfileEditor } from '@/components/profile';
import { Button, Disclaimer, Icon, Loading, Row, SectionHeader, Segmented, Text } from '@/components/ui';
import { confirm, notify } from '@/lib/dialogs';
import { relative } from '@/lib/format';
import { alpha, radius, space, TAP, useTheme } from '@/theme/theme';

const MEDAL = ['🥇', '🥈', '🥉'];

const input = fieldStyle;

function LeagueCard({ l, meId, onChanged }: { l: PrivateLeague; meId: string; onChanged: () => void }) {
  const t = useTheme();
  const [view, setView] = useState<'season' | 'week'>('season');
  const [shareImage, setShareImage] = useState(false);
  const rows = view === 'season' ? l.members : l.week_table;
  const share = async () => {
    try {
      const s = await api<{ text: string; url: string }>(`/pleagues/${l.code}/share`);
      haptic.tap();
      await Share.share({ message: s.text });
    } catch {
      notify('Could not create the link');
    }
  };
  const leave = async () => {
    if (!(await confirm('Leave this league?', `"${l.name}" and its table will be removed from this phone. You can join again with code ${l.code}.`, 'Leave', true))) return;
    await api(`/pleagues/${l.code}`, { method: 'DELETE' });
    onChanged();
  };
  const leader = l.members[0];
  return (
    <Glass style={{ marginBottom: space.md }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text v="h2" numberOfLines={1}>
            {l.name.toUpperCase()}
          </Text>
          <Text v="tiny" dim style={{ fontWeight: '700' }}>
            CODE {l.code} · {l.members.length} member{l.members.length === 1 ? '' : 's'}
            {l.my_rank ? ` · you're #${l.my_rank}` : ''}
          </Text>
        </View>
        {leader && leader.id === meId && l.members.length > 1 ? <Text style={{ fontSize: 26 }}>👑</Text> : null}
      </Row>
      <View style={{ marginTop: space.sm }}>
        <Segmented
          options={[
            { value: 'season', label: 'Season' },
            { value: 'week', label: 'This week' },
          ]}
          value={view}
          onChange={setView}
        />
      </View>
      <View style={{ marginTop: space.sm, gap: 6 }}>
        {rows.map((r, i) => {
          const me = r.id === meId;
          return (
            <FadeIn key={r.id} delay={i * 40}>
              <Row style={{ minHeight: 48, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: me ? alpha(t.brand, 0.16) : alpha(t.text, 0.04), borderWidth: me ? 1 : 0, borderColor: alpha(t.brand, 0.6) }} gap={space.sm}>
                <Text v="h2" style={{ width: 30, textAlign: 'center', fontSize: r.rank <= 3 && r.score > 0 ? 20 : 18 }} color={t.textDim}>
                  {r.rank <= 3 && r.score > 0 ? MEDAL[r.rank - 1] : r.rank}
                </Text>
                <Text style={{ fontSize: 22 }}>{r.avatar}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: me ? '900' : '700' }} numberOfLines={1}>
                    {r.name}
                    {me ? ' (you)' : ''}
                  </Text>
                  <Text v="tiny" muted numberOfLines={1}>
                    {r.correct}/{r.settled} correct{r.streak >= 2 ? ` · 🔥${r.streak}` : ''}
                    {me || r.at < 1e9 ? '' : ` · updated ${relative(r.at * 1000)}`}
                  </Text>
                </View>
                <Text v="h2" color={me ? t.brand : t.text}>
                  {r.score}
                </Text>
              </Row>
            </FadeIn>
          );
        })}
      </View>
      <Awards l={l} />
      {l.members.length === 1 ? (
        <Text v="small" dim style={{ marginTop: space.sm }}>
          Just you so far. Share the link in your group chat: friends who open it join the league and appear here once they share theirs.
        </Text>
      ) : null}
      <Row style={{ marginTop: space.md }} gap={space.sm}>
        <Button title="Share & update" icon="share-variant" onPress={share} style={{ flex: 1 }} />
        <PressableScale onPress={() => setShareImage(true)} accessibilityLabel="Share the table as an image" style={{ width: TAP, height: TAP, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(t.brand, 0.12) }}>
          <Icon name="image-outline" size={22} color={t.brand} />
        </PressableScale>
        <PressableScale onPress={leave} accessibilityLabel="Leave league" feedback="warn" style={{ width: TAP, height: TAP, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(t.loss, 0.12) }}>
          <Icon name="exit-run" size={22} color={t.loss} />
        </PressableScale>
      </Row>
      <ShareSheet visible={shareImage} onClose={() => setShareImage(false)} title={`${l.name} on MK Sports`}>
        <LeagueShareCard l={l} meId={meId} />
      </ShareSheet>
    </Glass>
  );
}

/** Matchweek awards from the members' score cards: last week's (final) and this week's so far. */
function Awards({ l }: { l: PrivateLeague }) {
  const t = useTheme();
  const last = l.awards?.last_week.items ?? [];
  const now = l.awards?.this_week.items ?? [];
  if (!last.length && !now.length) return null;
  const row = (a: (typeof last)[number], when: string) => (
    <Row key={`${when}-${a.key}`} style={{ paddingVertical: 6 }} gap={space.sm}>
      <Text style={{ fontSize: 20 }}>{a.emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text v="small" style={{ fontWeight: '800' }}>
          {a.title}
          <Text v="tiny" muted>{`  ${when}`}</Text>
        </Text>
        <Text v="small" dim numberOfLines={2}>
          {a.winners.map((w) => `${w.avatar} ${w.name}`).join(', ')} · {a.detail}
        </Text>
      </View>
    </Row>
  );
  return (
    <View style={{ marginTop: space.md, padding: space.sm, borderRadius: radius.md, backgroundColor: alpha(t.gold, 0.08), borderWidth: 1, borderColor: alpha(t.gold, 0.35) }}>
      <Text v="label" color={t.gold}>
        Matchweek awards
      </Text>
      {last.map((a) => row(a, 'last week'))}
      {now.map((a) => row(a, a.key === 'streak' ? 'now' : 'this week so far'))}
      <Text v="tiny" muted>
        Worked out from members&apos; shared score cards, so they count once everyone has shared after the weekend.
      </Text>
    </View>
  );
}

export default function PrivateLeaguesScreen() {
  const t = useTheme();
  const { me } = useAuth();
  const params = useLocalSearchParams<{ joined?: string; code?: string; members?: string }>();
  const data = useApi<PrivateLeagues>('/pleagues', { maxAge: 5 });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const d = data.data;
  const needsProfile = !me || me.display_name === 'You' || me.display_name === 'Player';

  useEffect(() => {
    if (params.joined === '1') haptic.success();
  }, [params.joined]);

  const refresh = () => {
    invalidate((k) => k.startsWith('/pleagues'));
    data.refresh();
  };
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ code: string }>('/pleagues', { method: 'POST', body: { name } });
      setName('');
      refresh();
      const s = await api<{ text: string }>(`/pleagues/${r.code}/share`);
      await Share.share({ message: s.text });
    } catch {
      notify('Could not create the league');
    } finally {
      setBusy(false);
    }
  };
  const joinByCode = async () => {
    setBusy(true);
    try {
      await api('/pleagues/join', { method: 'POST', body: { code } });
      setCode('');
      haptic.success();
      refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not join');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Backdrop height={420} />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <Row style={{ paddingHorizontal: space.lg, paddingVertical: space.sm }} gap={space.md}>
          <PressableScale onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityLabel="Back" style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(t.text, 0.08) }}>
            <Icon name="arrow-left" size={22} color={t.text} />
          </PressableScale>
          <Text v="title">PRIVATE LEAGUES</Text>
        </Row>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={refresh} tintColor={t.brand} />}>
          {params.code ? (
            <Pop>
              <Glass tint={t.brand} style={{ marginBottom: space.md }}>
                <Row>
                  <Text style={{ fontSize: 24 }}>🎉</Text>
                  <Text v="small" style={{ flex: 1, fontWeight: '700' }}>
                    {params.joined === '1' ? 'You joined the league!' : 'League table updated.'} Share it back so they see your score too.
                  </Text>
                </Row>
              </Glass>
            </Pop>
          ) : null}

          <FadeIn>
            <LinearGradient colors={[t.violet, t.hot]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: space.lg, overflow: 'hidden' }}>
              <View style={{ position: 'absolute', right: -30, top: -30, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.12)' }} />
              <Text v="label" color="rgba(255,255,255,0.9)">
                Free to play with your crew
              </Text>
              <Text v="hero" color="#fff" style={{ fontSize: 40, lineHeight: 42 }}>
                YOUR LEAGUE, YOUR RULES
              </Text>
              <Text v="small" color="rgba(255,255,255,0.92)" style={{ marginTop: 4 }}>
                Make picks as usual. Share the league link in your group chat: everyone who opens it joins, and every link updates the table.
              </Text>
            </LinearGradient>
          </FadeIn>

          {needsProfile || editProfile ? (
            <>
              <SectionHeader title="Your name and avatar" icon="account-edit-outline" />
              <Glass>
                <Text v="small" dim style={{ marginBottom: space.sm }}>
                  This is how your friends see you in league tables.
                </Text>
                <ProfileEditor me={me} onSaved={() => setEditProfile(false)} />
              </Glass>
            </>
          ) : (
            <PressableScale onPress={() => setEditProfile(true)} feedback="select" style={{ marginTop: space.md, alignSelf: 'flex-start' }}>
              <Row gap={6}>
                <Text style={{ fontSize: 20 }}>{me?.avatar ?? '⚽'}</Text>
                <Text v="small" style={{ fontWeight: '800' }}>
                  {me?.display_name}
                </Text>
                <Icon name="pencil-outline" size={16} color={t.brand} />
              </Row>
            </PressableScale>
          )}

          {data.loading && !d ? <Loading /> : null}
          {d?.leagues.length ? (
            <>
              <SectionHeader title={`My leagues · ${d.leagues.length}`} icon="trophy-outline" color={t.gold} />
              {d.leagues.map((l) => (
                <LeagueCard key={l.code} l={l} meId={d.me.id} onChanged={refresh} />
              ))}
            </>
          ) : null}

          <SectionHeader title="Create a league" icon="plus-circle-outline" />
          <Glass>
            <Row>
              <TextInput value={name} onChangeText={setName} maxLength={40} placeholder="e.g. Office League" placeholderTextColor={t.textMuted} style={input(t)} accessibilityLabel="League name" />
              <Button title="Create" icon="plus" onPress={create} loading={busy} disabled={name.trim().length < 2 || needsProfile} style={{ minWidth: 110 }} />
            </Row>
            {needsProfile ? (
              <Text v="tiny" muted style={{ marginTop: 6 }}>
                Set your name first, so your friends know who you are.
              </Text>
            ) : null}
          </Glass>

          <SectionHeader title="Join with a code" icon="ticket-confirmation-outline" />
          <Glass>
            <Row>
              <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" maxLength={6} placeholder="6-character code" placeholderTextColor={t.textMuted} style={[input(t), { letterSpacing: 3, fontWeight: '800' }]} accessibilityLabel="League code" />
              <Button title="Join" kind="secondary" onPress={joinByCode} loading={busy} disabled={code.replace(/[^A-Z0-9]/g, '').length !== 6 || needsProfile} style={{ minWidth: 96 }} />
            </Row>
            <Text v="tiny" muted style={{ marginTop: 6 }}>
              Got a link instead? Just tap it: it opens MK Sports and joins for you, with the latest table.
            </Text>
          </Glass>

          <Glass style={{ marginTop: space.lg }}>
            <Row style={{ alignItems: 'flex-start' }}>
              <Icon name="information-outline" color={t.textDim} />
              <Text v="small" dim style={{ flex: 1 }}>
                How it works: leagues live on each member's phone, so no account is needed. Points update whenever someone shares the league link; tap "Share & update" after each matchday. It's for fun among friends: there are no prizes and no money.
              </Text>
            </Row>
          </Glass>
          <Disclaimer compact />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export { ErrorBoundary } from '@/components/route-error';
