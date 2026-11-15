import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { API_URL, COOKIE_SECURE, KIOSK_COOKIE, forwardedFor } from '@/lib/server';

function sameSite(req: NextRequest) {
  const origin = req.headers.get('origin');
  return !!origin && new URL(origin).host === req.headers.get('host');
}

/** Pair this tablet with the code an admin created. The kiosk session lives in its own httpOnly cookie for a year. */
export async function POST(req: NextRequest) {
  if (!sameSite(req)) return NextResponse.json({ message: 'Refused' }, { status: 403 });
  const res = await fetch(`${API_URL}/api/kiosk/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...forwardedFor(req) },
    body: await req.text(),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  (await cookies()).set(KIOSK_COOKIE, data.token, {
    httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, path: '/', maxAge: 365 * 24 * 3600,
  });
  return NextResponse.json({ label: data.label, site: data.site });
}

/** Forget the pairing on this tablet (an admin can also retire it from Team > Kiosks). */
export async function DELETE(req: NextRequest) {
  if (!sameSite(req)) return NextResponse.json({ message: 'Refused' }, { status: 403 });
  (await cookies()).delete(KIOSK_COOKIE);
  return NextResponse.json({ ok: true });
}
