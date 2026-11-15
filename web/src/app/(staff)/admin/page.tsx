import { redirect } from 'next/navigation';
import { staffOnly } from '@/lib/server';
import { Admin } from './Admin';
import { TABS, type Tab } from './tabs';

export const metadata = { title: 'Admin' };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await staffOnly();
  if (me.role !== 'admin') redirect('/yard');
  const { tab } = await searchParams;
  const start = (TABS.find((t) => t.id === tab)?.id ?? 'overview') as Tab;
  return <Admin myId={me.id ?? ''} start={start} />;
}
