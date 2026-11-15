import { KIOSK_COOKIE, fromApi } from '@/lib/server';
import type { Me, SiteWording } from '@/lib/types';
import { SAFETY_VISITOR } from '@/lib/words';
import { Kiosk } from './Kiosk';
import { Pair } from './Pair';

export const metadata = { title: 'Welcome' };

export default async function KioskPage() {
  const { status, body } = await fromApi<Me>('/api/auth/me', KIOSK_COOKIE);
  if (status === 200 && body?.role === 'kiosk') {
    const wording = (await fromApi<SiteWording>('/api/site', KIOSK_COOKIE)).body;
    return <Kiosk site={body.site} rules={wording?.safetyVisitor ?? SAFETY_VISITOR} welcome={wording?.kioskWelcome ?? null} />;
  }
  return <Pair />;
}
