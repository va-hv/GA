import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { API_URL, COOKIE_SECURE, STAFF_COOKIE, forwardedFor } from '@/lib/server';

const HOURS = Number(process.env.SESSION_HOURS ?? 12);

function sameSite(req: NextRequest) {
  const origin = req.headers.get('origin');
  return !!origin && new URL(origin).host === req.headers.get('host');
}

/** Sign in: the token goes into an httpOnly cookie; the page only learns the role and whether to change password. */
export async function POST(req: NextRequest) {
  if (!sameSite(req)) return NextResponse.json({ message: 'Refused' }, { status: 403 });
  const res = await fetch(`${API_URL}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...forwardedFor(req) },
    body: await req.text(),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  (await cookies()).set(STAFF_COOKIE, data.token, {
    httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, path: '/', maxAge: HOURS * 3600,
  });
  return NextResponse.json({ role: data.role, mustChange: data.mustChange });
}

export async function DELETE(req: NextRequest) {
  if (!sameSite(req)) return NextResponse.json({ message: 'Refused' }, { status: 403 });
  const jar = await cookies();
  const token = jar.get(STAFF_COOKIE)?.value;
  if (token) {
    await fetch(`${API_URL}/api/auth/sign-out`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => undefined);
  }
  jar.delete(STAFF_COOKIE);
  return NextResponse.json({ ok: true });
}
