import Link from 'next/link';
import { Barrier } from './glyphs';

export function Wordmark({ href = '/', site }: { href?: string; site?: string }) {
  return (
    <Link href={href} className="flex min-w-0 items-center gap-2">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-ink text-paper"><Barrier width={24} height={24} /></span>
      <span className="min-w-0 leading-tight">
        <span className="block text-base font-black uppercase tracking-[0.18em]">Gatehouse</span>
        {site && <span className="block truncate text-xs font-semibold text-ink-2">{site}</span>}
      </span>
    </Link>
  );
}
