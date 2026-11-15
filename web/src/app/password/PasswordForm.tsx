'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Notice } from '@/components/kit';
import { Problem, send } from '@/lib/client';

export function PasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) {
      setProblem(new Problem('The two new passwords are different', 400, { again: 'Type the same password twice' }));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await send('POST', '/api/auth/password', { currentPassword: current, newPassword: next });
      router.replace('/yard');
      router.refresh();
    } catch (err) {
      setProblem(err as Problem);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
      {problem && <Notice>{problem.message}</Notice>}
      <Field label={forced ? 'Temporary password' : 'Current password'} type="password" autoComplete="current-password" required
        value={current} onChange={(e) => setCurrent(e.target.value)} error={problem?.fieldErrors.currentPassword} />
      <Field label="New password" type="password" autoComplete="new-password" required hint="At least 10 characters, with letters and numbers."
        value={next} onChange={(e) => setNext(e.target.value)} error={problem?.fieldErrors.newPassword} />
      <Field label="New password again" type="password" autoComplete="new-password" required
        value={again} onChange={(e) => setAgain(e.target.value)} error={problem?.fieldErrors.again} />
      <Button tone="go" big className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</Button>
      <p className="text-sm text-ink-2">Your other signed-in devices will be signed out.</p>
      {!forced && <Link href="/yard" className="text-sm font-semibold underline">Back to the yard</Link>}
    </form>
  );
}
