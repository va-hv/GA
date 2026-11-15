import { staffOnly } from '@/lib/server';
import type { Role } from '@/lib/types';
import { Log } from './Log';

export const metadata = { title: 'Log' };

export default async function LogPage() {
  const me = await staffOnly();
  return <Log role={me.role as Role} />;
}
