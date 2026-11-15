import type { ReactNode } from 'react';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { Wordmark } from '@/components/Wordmark';
import { staffOnly } from '@/lib/server';
import { ROLE_NAMES, type Role } from '@/lib/types';
import { StaffNav, SignOut } from './StaffNav';

const LINKS: Record<Role, { href: string; text: string }[]> = {
  security: [{ href: '/yard', text: 'Yard' }, { href: '/arrive', text: 'Check in driver' }, { href: '/log', text: 'Log' }],
  dock: [{ href: '/yard', text: 'Dock' }, { href: '/log', text: 'Log' }],
  admin: [{ href: '/yard', text: 'Yard' }, { href: '/log', text: 'Log' }, { href: '/admin', text: 'Admin' }, { href: '/about', text: 'About' }],
};

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const me = await staffOnly();
  const role = me.role as Role;
  return (
    <div className="min-h-[calc(100dvh-6px)]">
      <header className="no-print border-b-2 border-rule bg-sheet">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Wordmark site={me.site} href="/yard" />
          <div className="flex items-center gap-2">
            <span className="hidden text-right text-sm leading-tight sm:block">
              <span className="block font-bold">{me.name}</span>
              <span className="block text-ink-2">{ROLE_NAMES[role]}</span>
            </span>
            <ThemeSwitch />
            <SignOut />
          </div>
        </div>
        <StaffNav links={LINKS[role]} />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
