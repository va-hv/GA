import { redirect } from 'next/navigation';
import { fromApi, staffOnly } from '@/lib/server';
import type { SiteWording } from '@/lib/types';
import { SAFETY_DRIVER } from '@/lib/words';
import { ArriveForm } from './ArriveForm';

export const metadata = { title: 'Check in driver' };

export default async function ArrivePage() {
  const me = await staffOnly();
  if (me.role !== 'security') redirect('/yard');
  const wording = (await fromApi<SiteWording>('/api/site')).body;
  return (
    <div className="mx-auto max-w-3xl">
      <p className="tag">Gate · arrival</p>
      <h1 className="text-3xl font-black tracking-tight">Check in a driver</h1>
      <p className="mt-1 text-ink-2">Copy plates, trailer and seal exactly as they appear on the truck.</p>
      <ArriveForm safety={wording?.safetyDriver ?? SAFETY_DRIVER} />
    </div>
  );
}
