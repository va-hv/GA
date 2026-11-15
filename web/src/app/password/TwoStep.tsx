'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Notice, Stamp } from '@/components/kit';
import { Problem, send } from '@/lib/client';

/** Two-step sign-in: a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). */
export function TwoStep({ on, forced, required }: { on: boolean; forced: boolean; required: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<void>) {
    setBusy(true); setProblem(null); setDone('');
    try { await fn(); } catch (e) { setProblem(e as Problem); }
    setBusy(false);
  }

  return (
    <section className="mt-10 space-y-4 rounded-lg border-2 border-rule bg-sheet p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-extrabold">Two-step sign-in</p>
        {on ? <Stamp kind="in" label="On" /> : <Stamp kind="out" label="Off" />}
      </div>
      {forced && <Notice tone="wait">This site asks admins to use two-step sign-in. Set it up to continue.</Notice>}
      <p className="text-sm text-ink-2">After your password, you also type a 6-digit code from an app on your phone. Someone who learns your password still cannot get in.</p>
      {problem && <Notice>{problem.message}</Notice>}
      {done && <Notice tone="go">{done}</Notice>}

      {!on && !setup && <Button tone="go" disabled={busy} onClick={() => act(async () => setSetup(await send('POST', '/api/auth/two-step/start')))}>Set up two-step sign-in</Button>}

      {!on && setup && (
        <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); act(async () => {
          await send('POST', '/api/auth/two-step/confirm', { code });
          setDone('Two-step sign-in is on. Your other devices were signed out.');
          setSetup(null); setCode('');
          router.refresh();
          if (forced) router.replace('/yard');
        }); }}>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Open your authenticator app and choose to add an account by typing a key.</li>
            <li>Name it Gatehouse and type this key (time-based):
              <span className="mt-1 block break-all rounded-md border-2 border-ink bg-plate px-3 py-2 font-mono text-base font-bold tracking-widest">{setup.secret.match(/.{1,4}/g)?.join(' ')}</span>
              <a className="mt-1 inline-block font-semibold underline" href={setup.uri}>Or open it in an authenticator app on this device</a>
            </li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
          <Field label="Code" inputMode="numeric" autoComplete="one-time-code" mono maxLength={7} required value={code}
            onChange={(e) => setCode(e.target.value)} error={problem?.fieldErrors.code} />
          <Button tone="go" disabled={busy}>Turn on</Button>
        </form>
      )}

      {on && !required && (
        <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); act(async () => {
          await send('POST', '/api/auth/two-step/off', { currentPassword: password });
          setPassword(''); setDone('Two-step sign-in is off.'); router.refresh();
        }); }}>
          <Field label="Your password, to turn it off" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} error={problem?.fieldErrors.currentPassword} />
          <Button tone="stop" disabled={busy}>Turn off two-step sign-in</Button>
        </form>
      )}
      {on && required && <p className="text-sm text-ink-2">This site requires it for admins. Lost your phone? Another admin can reset it for you.</p>}
    </section>
  );
}
