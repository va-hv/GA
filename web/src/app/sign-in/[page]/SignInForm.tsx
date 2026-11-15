'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Notice } from '@/components/kit';
import { Problem, send } from '@/lib/client';
import { ROLE_NAMES, type Role } from '@/lib/types';

export function SignInForm({ page }: { page: Role }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [askCode, setAskCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const r = await send<{ role: Role; mustChange: boolean }>('POST', '/api/session', { page, username, password, ...(askCode ? { code } : {}) });
      router.replace(r.mustChange ? '/password' : '/yard');
      router.refresh();
    } catch (err) {
      const p = err as Problem;
      if (p.code === 'TWO_STEP_REQUIRED') { setAskCode(true); setProblem(null); } else { setProblem(p); setCode(''); }
      setBusy(false);
    }
  }

  const otherPage = problem?.code === 'WRONG_PAGE' ? (problem.extra.role as Role | undefined) : undefined;

  return (
    <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
      {problem && (
        <Notice>
          {problem.message}
          {otherPage && otherPage in ROLE_NAMES && (
            <> <Link className="underline" href={`/sign-in/${otherPage}`}>Go to {ROLE_NAMES[otherPage]} sign-in</Link></>
          )}
        </Notice>
      )}
      <Field label="Username" name="username" autoComplete="username" autoCapitalize="none" required
        value={username} onChange={(e) => setUsername(e.target.value)} error={problem?.fieldErrors.username} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required
        value={password} onChange={(e) => setPassword(e.target.value)} error={problem?.fieldErrors.password} />
      {askCode && (
        <Field label="Code from your authenticator app" name="code" inputMode="numeric" autoComplete="one-time-code" mono required autoFocus
          maxLength={7} hint="Six digits. A new one appears every 30 seconds." value={code} onChange={(e) => setCode(e.target.value)} />
      )}
      <Button tone="go" big className="w-full" disabled={busy}>{busy ? 'Signing in…' : askCode ? 'Check code and sign in' : 'Sign in'}</Button>
      <p className="text-sm text-ink-2">
        Not {ROLE_NAMES[page].toLowerCase()}? <Link href="/" className="font-semibold text-ink underline">Choose another sign-in</Link>.
        Forgot your password? Ask your site admin to reset it.
      </p>
    </form>
  );
}
