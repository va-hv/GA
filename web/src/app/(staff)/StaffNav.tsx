'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cx } from '@/components/kit';
import { send } from '@/lib/client';

export function StaffNav({ links }: { links: { href: string; text: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
      {links.map((l) => {
        const here = path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link key={l.href} href={l.href} aria-current={here ? 'page' : undefined}
            className={cx('whitespace-nowrap border-b-4 px-3 py-2.5 text-sm font-extrabold uppercase tracking-wider',
              here ? 'border-signal text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>
            {l.text}
          </Link>
        );
      })}
      <Link href="/password" className={cx('ml-auto whitespace-nowrap border-b-4 px-3 py-2.5 text-sm font-semibold',
        path === '/password' ? 'border-signal' : 'border-transparent text-ink-2 hover:text-ink')}>Password</Link>
    </nav>
  );
}

export function SignOut() {
  const router = useRouter();
  return (
    <button type="button" className="min-h-10 rounded-md border-2 border-rule px-3 text-sm font-bold text-ink-2 hover:border-rule-strong hover:text-ink"
      onClick={async () => { await send('DELETE', '/api/session').catch(() => undefined); router.replace('/'); router.refresh(); }}>
      Sign out
    </button>
  );
}
