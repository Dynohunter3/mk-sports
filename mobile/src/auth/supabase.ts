/**
 * Minimal Supabase Auth (GoTrue) client over REST: email/password, Google OAuth, phone OTP
 * and token refresh. Avoids bundling the full SDK on low-end devices.
 */
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export type Session = { access_token: string; refresh_token: string; expires_at: number };

export const supabaseConfigured = () => !!SUPABASE_URL && !!ANON;

async function call(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'Sign-in failed');
  return data;
}

function toSession(d: any): Session {
  return { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at ?? Math.floor(Date.now() / 1000) + (d.expires_in ?? 3600) };
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  return toSession(await call('/token?grant_type=password', { email, password }));
}

export async function signUp(email: string, password: string, fullName: string): Promise<Session | null> {
  const d = await call('/signup', { email, password, data: { full_name: fullName } });
  return d.access_token ? toSession(d) : null; // null = email confirmation required
}

export async function sendPhoneOtp(phone: string): Promise<void> {
  await call('/otp', { phone });
}

export async function verifyPhoneOtp(phone: string, token: string): Promise<Session> {
  return toSession(await call('/verify', { type: 'sms', phone, token }));
}

export async function refresh(refreshToken: string): Promise<Session> {
  return toSession(await call('/token?grant_type=refresh_token', { refresh_token: refreshToken }));
}

export async function signInWithGoogle(): Promise<Session | null> {
  const redirect = Linking.createURL('auth-callback');
  const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}`;
  const result = await WebBrowser.openAuthSessionAsync(url, redirect);
  if (result.type !== 'success') return null;
  // tokens come back in the URL fragment: #access_token=...&refresh_token=...&expires_in=...
  const fragment = result.url.split('#')[1] ?? '';
  const params = Object.fromEntries(fragment.split('&').map((kv) => kv.split('=').map(decodeURIComponent)));
  if (!params.access_token) throw new Error(params.error_description || 'Google sign-in failed');
  return toSession({ ...params, expires_in: Number(params.expires_in ?? 3600) });
}
