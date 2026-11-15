'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Notice } from '@/components/kit';
import { Tablet } from '@/components/glyphs';
import { Wordmark } from '@/components/Wordmark';
import { Problem, send } from '@/lib/client';

/** First run on a reception tablet: an admin types the pairing code from Team > Kiosks. */
export function Pair() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setProblem(null);
    try { await send('POST', '/api/kiosk-session', { code }); router.refresh(); }
    catch (err) { setProblem(err as Problem); setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <Wordmark />
      <div className="mt-12 rounded-lg border-2 border-rule bg-sheet p-6">
        <Tablet width={36} height={36} />
        <h1 className="mt-3 text-2xl font-black">Set up this tablet as a kiosk</h1>
        <p className="mt-1 text-ink-2">An admin adds a kiosk under Team &gt; Kiosks and gets a pairing code. Type it here.</p>
        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          {problem && <Notice>{problem.message}</Notice>}
          <Field label="Pairing code" mono required autoComplete="off" autoCapitalize="characters" placeholder="ABCDE-FGHJK"
            value={code} onChange={(e) => setCode(e.target.value)} error={problem?.fieldErrors.code} />
          <Button tone="go" big className="w-full" disabled={busy}>{busy ? 'Pairing…' : 'Pair this tablet'}</Button>
        </form>
      </div>
      <Link href="/" className="mt-4 inline-block text-sm text-ink-2 underline">Staff sign-in</Link>
    </main>
  );
}
