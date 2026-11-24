/** Name and avatar: how a player appears in league tables (stored on this phone). */
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { invalidate } from '@/api/cache';
import { api } from '@/api/client';
import type { Me } from '@/api/types';
import { useAuth } from '@/auth/auth';
import { notify } from '@/lib/dialogs';
import { alpha, radius, space, TAP, useTheme } from '@/theme/theme';

import { haptic, PressableScale } from './motion';
import { Button, Row, Text } from './ui';

export const AVATARS = ['⚽', '🦁', '🐆', '🦅', '🔥', '⚡', '👑', '🎯', '🚀', '🐐', '🌍', '💎'];

export function fieldStyle(t: ReturnType<typeof useTheme>) {
  return { flex: 1, minHeight: TAP, borderRadius: radius.md, borderWidth: 1, borderColor: t.glassBorder, color: t.text, paddingHorizontal: space.md, backgroundColor: t.surface2, fontSize: 16 } as const;
}

export function ProfileEditor({ me, onSaved }: { me: Me | null; onSaved?: () => void }) {
  const t = useTheme();
  const auth = useAuth();
  const [name, setName] = useState(me && me.display_name !== 'You' ? me.display_name : '');
  const [avatar, setAvatar] = useState(me?.avatar ?? '⚽');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api('/me', { method: 'PATCH', body: { display_name: name.trim(), avatar } });
      await auth.refreshMe();
      invalidate((k) => k.startsWith('/pleagues') || k.startsWith('/me'));
      haptic.success();
      onSaved?.();
    } catch {
      notify('Could not save your profile');
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ flexWrap: 'wrap' }} gap={6}>
        {AVATARS.map((a) => (
          <PressableScale key={a} onPress={() => setAvatar(a)} feedback="select" accessibilityLabel={`Avatar ${a}`} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: avatar === a ? t.brand : 'transparent', backgroundColor: avatar === a ? alpha(t.brand, 0.18) : alpha(t.text, 0.06) }}>
            <Text style={{ fontSize: 22 }}>{a}</Text>
          </PressableScale>
        ))}
      </Row>
      <Row>
        <TextInput value={name} onChangeText={setName} maxLength={30} placeholder="Your name" placeholderTextColor={t.textMuted} style={fieldStyle(t)} accessibilityLabel="Your name" />
        <Button title="Save" onPress={save} loading={saving} disabled={name.trim().length < 2} style={{ minWidth: 96 }} />
      </Row>
    </View>
  );
}

