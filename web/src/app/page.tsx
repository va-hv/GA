import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Notice } from '@/components/kit';
import { Dock, Key, Tablet, Arrow } from '@/components/glyphs';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { Wordmark } from '@/components/Wordmark';
import { fromApi } from '@/lib/server';
import type { Me } from '@/lib/types';
import { Barrier } from '@/components/glyphs';

const DOORS = [
  { href: '/sign-in/security', title: 'Security', text: 'Check drivers in, release trucks and people at the gate.', Icon: Barrier },
  { href: '/sign-in/dock', title: 'Dock coordinator', text: 'Clear trucks at the dock: empty, or trailer and seal out.', Icon: Dock },
  { href: '/sign-in/admin', title: 'Admin', text: 'People, roles, kiosks and the history.', Icon: Key },
];

export default async function FrontDoor({ searchParams }: { searchParams: Promise<{ ended?: string }> }) {
  const { status, body } = await fromApi<Me>('/api/auth/me');
  if (status === 200 && body && body.role !== 'kiosk') redirect(body.mustChange || body.mustSetUpTwoStep ? '/password' : '/yard');
  const { ended } = await searchParams;

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-6px)] max-w-5xl flex-col px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <Wordmark />
        <ThemeSwitch />
      </header>

      <section className="mt-10 sm:mt-16">
        <p className="tag">Gate and reception</p>
        <h1 className="mt-2 max-w-2xl text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl">
          Who is on site, who is cleared, who has left.
        </h1>
        <p className="mt-3 max-w-xl text-lg text-ink-2">
          Visitors sign in at the kiosk. Security checks drivers in. The dock clears each truck before the gate lets it go.
        </p>
      </section>

      {ended && <div className="mt-6 max-w-xl"><Notice tone="info">Your session ended. Please sign in again.</Notice></div>}

      <nav aria-label="Sign in" className="mt-8 grid gap-3 sm:grid-cols-3">
        {DOORS.map(({ href, title, text, Icon }) => (
          <Link key={href} href={href}
            className="group flex flex-col justify-between rounded-lg border-2 border-rule bg-sheet p-5 transition hover:border-ink">
            <span className="flex items-center justify-between">
              <Icon width={30} height={30} />
              <Arrow className="text-ink-2 transition group-hover:translate-x-1 group-hover:text-signal" />
            </span>
            <span className="mt-6">
              <span className="block text-xl font-extrabold">Sign in as {title}</span>
              <span className="mt-1 block text-sm text-ink-2">{text}</span>
            </span>
          </Link>
        ))}
      </nav>

      <Link href="/kiosk" className="mt-3 flex items-center gap-3 rounded-lg border-2 border-dashed border-rule px-5 py-4 text-ink-2 hover:border-rule-strong hover:text-ink">
        <Tablet />
        <span><span className="font-bold text-ink">This is the reception tablet.</span> Open the visitor kiosk.</span>
      </Link>

      <footer className="mt-auto pt-10 text-xs text-ink-2">Gatehouse · sign-ins are recorded</footer>
    </main>
  );
}
