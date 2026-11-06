import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { Pressable, ScrollView, TextInput, TextInputProps, View } from 'react-native';

import { useAuth } from '@/auth/auth';
import { supabaseConfigured } from '@/auth/supabase';
import { Button, Card, Disclaimer, Icon, Row, Segmented, Text } from '@/components/ui';
import { radius, space, TAP, useTheme } from '@/theme/theme';

type Mode = 'signin' | 'register' | 'phone';

function Field(props: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text v="small" dim>
        {props.label}
      </Text>
      <TextInput
        placeholderTextColor={t.textMuted}
        {...props}
        style={{ minHeight: TAP, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.text, paddingHorizontal: space.md, fontSize: 16 }}
      />
    </View>
  );
}

function Check({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => onChange(!on)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TAP }}>
      <Icon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={on ? t.brand : t.textMuted} />
      <Text v="small" style={{ flex: 1 }}>
        {children}
      </Text>
    </Pressable>
  );
}

export default function SignIn() {
  const t = useTheme();
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const supa = auth.mode === 'supabase' && supabaseConfigured();

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  const done = () => (router.canGoBack() ? router.back() : router.replace('/profile'));

  // Signed in via Google/phone but hasn't accepted the terms yet
  if (auth.me && !auth.me.consented) {
    return (
      <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, gap: space.md }}>
        <Text v="h2">Before you play</Text>
        <Text dim>MK Sports is free to play. We store your picks and profile to run the game; you can export or delete your data at any time in Settings.</Text>
        <Check on={terms} onChange={setTerms}>
          I accept the Terms of Use and Privacy Policy, and I understand predictions are not betting advice.
        </Check>
        <Check on={marketing} onChange={setMarketing}>
          Send me occasional product news (optional)
        </Check>
        {error ? <Text color={t.loss}>{error}</Text> : null}
        <Button title="Continue" disabled={!terms} loading={busy} onPress={() => run(async () => { await auth.acceptConsent(marketing); done(); })} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      <Segmented<Mode>
        options={[{ value: 'signin', label: 'Sign in' }, { value: 'register', label: 'Create account' }, ...(supa ? [{ value: 'phone' as Mode, label: 'Phone' }] : [])]}
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError(null);
        }}
      />

      {mode === 'phone' ? (
        <>
          <Field label="Mobile number (with country code)" value={phone} onChangeText={setPhone} placeholder="+260 97 123 4567" keyboardType="phone-pad" autoComplete="tel" />
          {otpSent ? <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="sms-otp" /> : null}
          <Check on={terms} onChange={setTerms}>
            I accept the Terms of Use and Privacy Policy
          </Check>
          <Button
            title={otpSent ? 'Verify & sign in' : 'Send code'}
            disabled={!terms || !phone}
            loading={busy}
            onPress={() =>
              run(async () => {
                if (!otpSent) {
                  await auth.sendOtp(phone.replace(/\s/g, ''));
                  setOtpSent(true);
                } else {
                  await auth.verifyOtp(phone.replace(/\s/g, ''), code);
                  await auth.acceptConsent(marketing);
                  done();
                }
              })
            }
          />
        </>
      ) : (
        <>
          {mode === 'register' ? <Field label="Display name" value={name} onChangeText={setName} placeholder="e.g. Chanda M." maxLength={40} autoComplete="nickname" /> : null}
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder={mode === 'register' ? 'At least 8 characters' : ''} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
          {mode === 'register' ? (
            <>
              <Check on={terms} onChange={setTerms}>
                I accept the Terms of Use and Privacy Policy, and I understand predictions are not betting advice.
              </Check>
              <Check on={marketing} onChange={setMarketing}>
                Send me occasional product news (optional)
              </Check>
            </>
          ) : null}
          {error ? <Text color={t.loss}>{error}</Text> : null}
          {info ? <Text color={t.win}>{info}</Text> : null}
          <Button
            title={mode === 'register' ? 'Create free account' : 'Sign in'}
            loading={busy}
            disabled={!email || password.length < (mode === 'register' ? 8 : 1) || (mode === 'register' && (!terms || name.trim().length < 2))}
            onPress={() =>
              run(async () => {
                if (mode === 'signin') {
                  await auth.signInEmail(email.trim(), password);
                  done();
                } else {
                  const r = await auth.register({ email: email.trim(), password, name: name.trim(), marketing });
                  if (r === 'confirm_email') setInfo('Check your inbox to confirm your email, then sign in.');
                  else done();
                }
              })
            }
          />
        </>
      )}

      {supa ? (
        <Button title="Continue with Google" kind="secondary" icon="google" loading={busy} onPress={() => run(async () => { if (await auth.signInGoogle()) done(); })} />
      ) : null}

      {auth.mode === 'dev' ? (
        <Card style={{ gap: space.sm }}>
          <Row>
            <Icon name="flask-outline" color={t.pending} />
            <Text style={{ fontWeight: '700' }}>Development mode</Text>
          </Row>
          <Text v="small" dim>
            Google and phone sign-in are enabled when the app is configured with Supabase Auth. Try the seeded demo account to see a profile with history, streaks and badges.
          </Text>
          <Button title="Use the demo account" kind="secondary" icon="account-star-outline" loading={busy} onPress={() => run(async () => { await auth.signInDemo(); done(); })} />
        </Card>
      ) : null}
      <Disclaimer compact />
    </ScrollView>
  );
}
