/**
 * Opened from a league link (mksports://pl?d=...): join the league or update its table, then show it.
 * The web page at <SITE>/l.html forwards here, so links shared on WhatsApp are tappable.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { invalidate } from '@/api/cache';
import { api } from '@/api/client';
import { EmptyState, Loading } from '@/components/ui';

export default function LeagueLink() {
  const { d } = useLocalSearchParams<{ d?: string }>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!d) {
      setError('This league link is incomplete.');
      return;
    }
    api<{ code: string; joined: boolean; members: number }>('/pleagues/link', { method: 'POST', body: { data: d } })
      .then((r) => {
        invalidate((k) => k.startsWith('/pleagues'));
        router.replace({ pathname: '/private-leagues', params: { code: r.code, joined: r.joined ? '1' : '0', members: String(r.members) } });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'This link could not be read'));
  }, [d]);
  if (error) return <EmptyState icon="link-variant-off" title="Couldn't open the league" body={error} action="My leagues" onAction={() => router.replace('/private-leagues')} />;
  return <Loading label="Opening your league…" />;
}
