/**
 * Shareable cards sized for WhatsApp Status and stories (9:16, saved at 1080 x 1920): your week against the AI,
 * a match prediction, a private league table and the season recap. Every card carries the download QR code,
 * so each share also shows where to get the app.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import QRCode from 'qrcode';
import { ComponentRef, ReactNode, RefObject, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import Svg, { Path, Rect } from 'react-native-svg';

import { SITE } from '@/data/pleagues';
import { FONTS } from '@/theme/fonts';
import { alpha, onColor, space } from '@/theme/theme';

import { Button, Icon, Text } from './ui';

export const CARD_W = 360;
export const CARD_H = 640;
export const DOWNLOAD_URL = `${SITE}/`;
const INK = '#060A16';
const GREEN = '#2CF59A';

/** The QR code as one SVG path (one square per dark module). */
export function qrPath(text: string): { size: number; d: string } {
  const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = q.modules.size;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules.data[y * n + x]) d += `M${x} ${y}h1v1h-1z`;
  return { size: n, d };
}

export function QR({ text, size }: { text: string; size: number }) {
  const { size: n, d } = useMemo(() => qrPath(text), [text]);
  const quiet = 2;
  return (
    <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${n + 2 * quiet} ${n + 2 * quiet}`}>
      <Rect x={-quiet} y={-quiet} width={n + 2 * quiet} height={n + 2 * quiet} fill="#FFFFFF" />
      <Path d={d} fill="#000000" />
    </Svg>
  );
}

/** The card frame: brand at the top, your content, and the download QR at the bottom. */
export function CardFrame({ children, accent = GREEN, kicker }: { children: ReactNode; accent?: string; kicker: string }) {
  return (
    <LinearGradient colors={['#14245A', INK, INK]} locations={[0, 0.55, 1]} style={st.card}>
      <View style={[st.glow, { backgroundColor: alpha(accent, 0.22) }]} />
      <View style={st.head}>
        <Image source={require('../../assets/icon.png')} style={{ width: 34, height: 34, borderRadius: 9 }} />
        <Text style={st.brand}>
          MK <Text style={[st.brand, { color: GREEN }]}>SPORTS</Text>
        </Text>
      </View>
      <Text style={[st.kicker, { color: accent }]}>{kicker}</Text>
      <View style={{ flex: 1 }}>{children}</View>
      <View style={st.foot}>
        <QR text={DOWNLOAD_URL} size={92} />
        <View style={{ flex: 1 }}>
          <Text style={st.footTitle}>Call it. Beat the AI.</Text>
          <Text style={st.footText}>Free on Android: scan to get MK Sports</Text>
          <Text style={st.footUrl}>dynohunter3.github.io/mk-sports</Text>
        </View>
      </View>
      <Text style={st.notice}>Free to play, no money involved. Predictions are for entertainment.</Text>
    </LinearGradient>
  );
}

/** A big number with a label, for card content. */
export function CardStat({ value, label, color = '#FFFFFF' }: { value: string; label: string; color?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[st.big, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={st.label}>{label}</Text>
    </View>
  );
}

export function CardBadge({ color, code, logo }: { color: string; code: string; logo?: string | null }) {
  return logo ? (
    <Image source={{ uri: logo }} style={{ width: 64, height: 64 }} contentFit="contain" />
  ) : (
    <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: onColor(color), fontFamily: FONTS.display, fontSize: 22 }}>{code}</Text>
    </View>
  );
}

/** Save the card as a 1080 x 1920 PNG and open the share sheet. */
type CardRef = RefObject<ComponentRef<typeof View> | null>;

export async function shareCardImage(ref: CardRef, title: string): Promise<'shared' | 'unsupported' | 'failed'> {
  if (Platform.OS === 'web' || !ref.current) return 'unsupported';
  try {
    const uri = await captureRef(ref as unknown as Parameters<typeof captureRef>[0], { format: 'png', quality: 1, width: 1080, height: 1920, result: 'tmpfile' });
    if (!(await Sharing.isAvailableAsync())) return 'unsupported';
    await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: title, UTI: 'public.png' });
    return 'shared';
  } catch {
    return 'failed';
  }
}

/** A preview of the card with a Share button. */
export function ShareSheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const { width, height } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const scale = Math.min((width - 48) / CARD_W, (height - 190) / CARD_H, 1.2);
  const share = async () => {
    setBusy(true);
    setMsg(null);
    const r = await shareCardImage(ref, title);
    setBusy(false);
    if (r === 'unsupported') setMsg('Sharing images works in the Android app.');
    else if (r === 'failed') setMsg('Could not make the image. Try again.');
  };
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="fade" transparent statusBarTranslucent>
      <View style={st.backdrop}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={st.close} hitSlop={12}>
          <Icon name="close" size={26} color="#FFFFFF" />
        </Pressable>
        <View style={{ width: CARD_W * scale, height: CARD_H * scale, overflow: 'hidden', borderRadius: 18 }}>
          <View style={{ width: CARD_W, height: CARD_H, transform: [{ scale }], transformOrigin: 'top left' }}>
            <View ref={ref} collapsable={false} style={{ width: CARD_W, height: CARD_H }}>
              {children}
            </View>
          </View>
        </View>
        <View style={{ width: CARD_W * scale, marginTop: space.lg }}>
          <Button title="Share image" icon="share-variant" onPress={share} loading={busy} />
          {msg ? (
            <Text v="small" color="#FFFFFF" style={{ textAlign: 'center', marginTop: space.sm }}>
              {msg}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  card: { width: CARD_W, height: CARD_H, padding: 24, overflow: 'hidden' },
  glow: { position: 'absolute', width: 420, height: 420, borderRadius: 210, top: -180, right: -160 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brand: { color: '#FFFFFF', fontFamily: FONTS.displayItalic, fontSize: 24, letterSpacing: 0.5 },
  kicker: { fontFamily: FONTS.displaySemi, fontSize: 15, letterSpacing: 1.6, textTransform: 'uppercase', marginTop: 22, marginBottom: 6 },
  big: { fontFamily: FONTS.display, fontSize: 54, lineHeight: 60 },
  label: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  footTitle: { color: '#FFFFFF', fontFamily: FONTS.display, fontSize: 22, textTransform: 'uppercase' },
  footText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  footUrl: { color: GREEN, fontSize: 11, fontWeight: '700', marginTop: 4 },
  notice: { color: 'rgba(255,255,255,0.5)', fontSize: 9, textAlign: 'center', marginTop: 10 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  close: { position: 'absolute', top: 48, right: 24, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
