import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Me } from './types';

export const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3601';
export const STAFF_COOKIE = 'gh_staff';
export const KIOSK_COOKIE = 'gh_kiosk';
export const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

/** Reads from the API on the server, with the session from the httpOnly cookie. Page scripts never see the token. */
export async function fromApi<T>(path: string, cookie = STAFF_COOKIE): Promise<{ status: number; body: T | null }> {
  const token = (await cookies()).get(cookie)?.value;
  if (!token) return { status: 401, body: null };
  const res = await fetch(API_URL + path, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  let body: T | null = null;
  try { body = (await res.json()) as T; } catch { /* empty */ }
  return { status: res.status, body };
}

/** The signed-in staff member, or a trip back to the front door. */
export async function staffOnly(): Promise<Me> {
  const { status, body } = await fromApi<Me>('/api/auth/me');
  if (status !== 200 || !body || body.role === 'kiosk') redirect('/');
  if (body.mustChange || body.mustSetUpTwoStep) redirect('/password');
  return body;
}

/**
 * The visitor's address for the sign-in lockout. Only trusted when a reverse proxy in front sets it (BEHIND_PROXY=true),
 * and then only the hop that proxy added; otherwise a browser could send any address it likes.
 */
export function forwardedFor(req: Request): Record<string, string> {
  if (process.env.BEHIND_PROXY !== 'true') return {};
  const last = req.headers.get('x-forwarded-for')?.split(',').pop()?.trim();
  return last ? { 'x-forwarded-for': last } : {};
}
