import { staffOnly } from '@/lib/server';
import type { Role } from '@/lib/types';
import { Yard } from './Yard';

export const metadata = { title: 'Yard' };

export default async function YardPage() {
  const me = await staffOnly();
  return <Yard role={me.role as Role} />;
}
