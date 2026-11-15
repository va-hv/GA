import { notFound } from 'next/navigation';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { Wordmark } from '@/components/Wordmark';
import { ROLE_NAMES, type Role } from '@/lib/types';
import { SignInForm } from './SignInForm';

export const metadata = { title: 'Sign in' };

export default async function SignIn({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(page in ROLE_NAMES)) notFound();
  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <header className="flex items-center justify-between"><Wordmark /><ThemeSwitch /></header>
      <div className="mt-12">
        <p className="tag">Sign in</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">{ROLE_NAMES[page as Role]}</h1>
        <SignInForm page={page as Role} />
      </div>
    </main>
  );
}
