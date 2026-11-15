import { redirect } from 'next/navigation';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { Wordmark } from '@/components/Wordmark';
import { fromApi } from '@/lib/server';
import type { Me } from '@/lib/types';
import { PasswordForm } from './PasswordForm';
import { TwoStep } from './TwoStep';

export const metadata = { title: 'Change password' };

export default async function PasswordPage() {
  const { status, body } = await fromApi<Me>('/api/auth/me');
  if (status !== 200 || !body || body.role === 'kiosk') redirect('/');
  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <header className="flex items-center justify-between"><Wordmark site={body.site} href="/yard" /><ThemeSwitch /></header>
      <div className="mt-12">
        <p className="tag">{body.name}</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">{body.mustChange ? 'Choose your own password' : body.mustSetUpTwoStep ? 'Set up two-step sign-in' : 'Password and two-step sign-in'}</h1>
        {body.mustChange && <p className="mt-2 text-ink-2">You signed in with a temporary password. Pick one only you know before going on.</p>}
        {body.mustChange ? <PasswordForm forced /> : (
          <>
            {!body.mustSetUpTwoStep && <PasswordForm forced={false} />}
            <TwoStep on={!!body.twoStep} forced={!!body.mustSetUpTwoStep} required={!!body.twoStepRequired} />
          </>
        )}
      </div>
    </main>
  );
}
