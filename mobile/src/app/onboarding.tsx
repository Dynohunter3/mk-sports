import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api/cache';
import { api, qs } from '@/api/client';
import type { League, Me, Sport, Team } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { FadeIn, Pop } from '@/components/motion';
import { LogoMark } from '@/components/brand';
import { Backdrop } from '@/components/glass';
import { TeamBadge } from '@/components/match';
import { toFavourite } from '@/components/teamhub';
import { Button, Card, Chip, Icon, Loading, Row, Text } from '@/components/ui';
import { usePrefs } from '@/state/prefs';
import { alpha, radius, space, SPORT_ICONS, TAP, useTheme } from '@/theme/theme';

const STEPS = ['welcome', 'sports', 'leagues', 'teams'] as const;

function toggle(list: string[], id: string) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export default function Onboarding() {
  const t = useTheme();
  const { prefs, update } = usePrefs();
  const { signedIn, mode, me, acceptConsent } = useAuth();
  const [step, setStep] = useState(prefs.onboarded ? 1 : 0);
  const [sports, setSports] = useState<string[]>(prefs.sports);
  const [leagues, setLeagues] = useState<string[]>(prefs.leagues);
  const [teams, setTeams] = useState<string[]>(prefs.favoriteTeam ? [prefs.favoriteTeam.id] : []);
  const [picked, setPicked] = useState<Record<string, Team>>({});
  const [search, setSearch] = useState('');

  const allSports = useApi<Sport[]>('/sports?include_inactive=true', { maxAge: 3600 });
  const allLeagues = useApi<League[]>('/leagues', { maxAge: 3600 });
  const firstLeague = leagues[0] ?? allLeagues.data?.find((l) => l.is_featured)?.id;
  const suggestions = useApi<Team[]>(step === 3 ? (search.trim().length >= 2 ? `/teams${qs({ search: search.trim(), limit: 20 })}` : firstLeague ? `/teams?league_id=${firstLeague}&limit=40` : null) : null, { maxAge: 3600 });

  const activeSports = (allSports.data ?? []).filter((s) => s.is_active);
  const comingSoon = (allSports.data ?? []).filter((s) => !s.is_active);
  const visibleLeagues = useMemo(() => {
    const slugs = new Set(activeSports.filter((s) => sports.length === 0 || sports.includes(s.id)).map((s) => s.slug));
    return (allLeagues.data ?? []).filter((l) => slugs.has(l.sport));
  }, [allLeagues.data, activeSports, sports]);

  async function finish() {
    const favTeam = teams[0] ? picked[teams[0]] : null;
    const fav = favTeam ? toFavourite(favTeam, favTeam.sport, favTeam.leagues?.length ? favTeam.leagues : firstLeague ? [firstLeague] : []) : prefs.favoriteTeam;
    const sel = { sports: fav && !sports.includes(fav.sport) && sports.length ? [...sports, fav.sport] : sports, leagues: [...new Set([...leagues, ...(fav?.leagues ?? [])])], teams };
    update({ ...sel, favoriteTeam: fav ?? null, onboarded: true });
    if (signedIn) await api<Me>('/me/favourites', { method: 'PUT', body: sel }).catch(() => null);
    router.replace('/');
  }

  if (allSports.loading) return <Loading label="Loading sports…" />;
  const name = STEPS[step];
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
    <Backdrop />
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <Row style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: 6 }}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? t.brand : t.glassBorder }} />
        ))}
      </Row>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        {name === 'welcome' ? (
          <View style={{ gap: space.lg, paddingTop: space.xl }}>
            <Pop>
              <LogoMark size={96} />
            </Pop>
            <FadeIn delay={120}>
              <Text v="hero" style={{ fontSize: 52, lineHeight: 54 }}>
                CALL IT.
              </Text>
              <Text v="hero" color={t.brand} style={{ fontSize: 52, lineHeight: 54 }}>
                BEAT THE AI.
              </Text>
            </FadeIn>
            <FadeIn delay={220}>
              <Text v="h3" dim>
                Live scores, line-ups and stats for the world's favourite sports, AI predictions that show their working, and a free game where your calls take on the machine.
              </Text>
            </FadeIn>
            {[
              ['cards-playing-outline', 'Quick Picks', 'Swipe through the next matches and call each one. Then see if you beat the AI.', t.hot],
              ['robot-outline', 'AI predictions', 'Win, draw or away calls with their real track record, key factors and a safer call.', t.violet],
              ['lightning-bolt-outline', 'Live match centre', 'Line-ups in formation, live stats, xG, timelines and player stats.', t.gold],
              ['trophy-outline', 'Levels, streaks and badges', 'Climb from Rookie to GOAT. Free to play, always.', t.brand],
            ].map(([icon, title, body, color], i) => (
              <FadeIn key={title} delay={320 + i * 90}>
                <Row style={{ alignItems: 'flex-start' }} gap={space.md}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(color, 0.18), borderWidth: 1, borderColor: alpha(color, 0.45) }}>
                    <Icon name={icon} size={24} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text v="h2" style={{ fontSize: 21, lineHeight: 24 }}>
                      {title.toUpperCase()}
                    </Text>
                    <Text v="small" dim>
                      {body}
                    </Text>
                  </View>
                </Row>
              </FadeIn>
            ))}
            <Card tint={t.pending}>
              <Row style={{ alignItems: 'flex-start' }}>
                <Icon name="shield-alert-outline" color={t.pending} />
                <Text v="small" style={{ flex: 1 }}>
                  Predictions are for information and entertainment only and are <Text v="small" style={{ fontWeight: '800' }}>not betting advice</Text>. The game is free to play with no real-money stakes.{mode === 'device' ? ' Your picks and points are stored only on this phone; no account or personal data is needed. By continuing you accept the terms of use.' : ''}
                </Text>
              </Row>
            </Card>
          </View>
        ) : null}

        {name === 'sports' ? (
          <View style={{ gap: space.md }}>
            <Text v="h2">Which sports do you follow?</Text>
            <Text dim>We'll put these first. You can change this any time in Settings.</Text>
            {activeSports.map((s) => {
              const on = sports.includes(s.id);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setSports(toggle(sports, s.id))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: 2, borderColor: on ? s.color : t.glassBorder, backgroundColor: on ? s.color + '1F' : t.glass }}
                >
                  <Icon name={SPORT_ICONS[s.slug] ?? s.icon} size={30} color={s.color} />
                  <Text v="h3" style={{ flex: 1 }}>
                    {s.name}
                  </Text>
                  <Icon name={on ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={24} color={on ? s.color : t.textMuted} />
                </Pressable>
              );
            })}
            <Text v="label" dim style={{ marginTop: space.md }}>
              Coming soon
            </Text>
            <Row style={{ flexWrap: 'wrap' }}>
              {comingSoon.map((s) => (
                <Chip key={s.id} label={s.name} icon={SPORT_ICONS[s.slug]} disabled badge={s.tier === 1 ? 'next' : 'later'} />
              ))}
            </Row>
          </View>
        ) : null}

        {name === 'leagues' ? (
          <View style={{ gap: space.sm }}>
            <Text v="h2">Pick your competitions</Text>
            <Text dim style={{ marginBottom: space.sm }}>
              Your home feed shows these first, including local leagues.
            </Text>
            {visibleLeagues.map((l) => {
              const on = leagues.includes(l.id);
              return (
                <Pressable
                  key={l.id}
                  onPress={() => setLeagues(toggle(leagues, l.id))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={{ minHeight: TAP + 8, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: on ? t.brand + '1F' : t.glass, borderWidth: 1, borderColor: on ? t.brand : t.glassBorder }}
                >
                  <Icon name={SPORT_ICONS[l.sport]} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '600' }}>{l.name}</Text>
                    <Text v="tiny" muted>
                      {l.country ?? l.region}
                    </Text>
                  </View>
                  <Icon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} color={on ? t.brand : t.textMuted} />
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {name === 'teams' ? (
          <View style={{ gap: space.md }}>
            <Text v="h2">Choose your team</Text>
            <Text dim>Their fixtures, results, news and stats come first, and they get their own tab.</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.glass, borderRadius: radius.md, borderWidth: 1, borderColor: t.glassBorder, paddingHorizontal: space.md }}>
              <Icon name="magnify" />
              <TextInput value={search} onChangeText={setSearch} placeholder="Search teams" placeholderTextColor={t.textMuted} style={{ flex: 1, minHeight: TAP, color: t.text, paddingHorizontal: space.sm, fontSize: 15 }} accessibilityLabel="Search teams" />
            </View>
            {teams.length ? (
              <Row style={{ flexWrap: 'wrap' }}>
                {teams.map((tid) => (
                  <Chip key={tid} label={`My team: ${picked[tid]?.short_name ?? prefs.favoriteTeam?.short_name ?? tid}`} selected icon="close" onPress={() => setTeams([])} />
                ))}
              </Row>
            ) : null}
            <Row style={{ flexWrap: 'wrap' }}>
              {(suggestions.data ?? []).map((tm) => {
                const on = teams.includes(tm.id);
                return (
                  <Pressable
                    key={tm.id}
                    onPress={() => {
                      setPicked({ ...picked, [tm.id]: tm });
                      setTeams(on ? [] : [tm.id]);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    style={{ width: '31%', minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.md, borderWidth: 1, borderColor: on ? t.brand : t.glassBorder, backgroundColor: on ? t.brand + '1F' : t.glass, padding: space.sm }}
                  >
                    <TeamBadge team={tm} size={40} />
                    <Text v="tiny" numberOfLines={1} style={{ fontWeight: '600' }}>
                      {tm.short_name}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
          </View>
        ) : null}
      </ScrollView>
      <Row style={{ padding: space.lg, borderTopWidth: 1, borderColor: t.glassBorder }}>
        {step > 0 ? <Button title="Back" kind="secondary" onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : null}
        {step < STEPS.length - 1 ? (
          <Button
            title={step === 0 ? (mode === 'device' && !me?.consented ? 'Agree & get started' : 'Get started') : 'Continue'}
            onPress={() => {
              if (step === 0 && mode === 'device' && !me?.consented) acceptConsent(false).catch(() => undefined);
              setStep(step + 1);
            }}
            style={{ flex: 2 }}
          />
        ) : (
          <Button title="Show my feed" icon="check" onPress={finish} style={{ flex: 2 }} />
        )}
      </Row>
      {step > 0 && step < STEPS.length - 1 ? (
        <Pressable onPress={finish} style={{ alignItems: 'center', paddingBottom: space.md, minHeight: TAP, justifyContent: 'center' }}>
          <Text v="small" muted>
            Skip for now
          </Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
    </View>
  );
}
