import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { API_URL, KIOSK_COOKIE, STAFF_COOKIE, forwardedFor } from '@/lib/server';

/**
 * The browser's only way to the API. Adds the session from the httpOnly cookie and refuses cross-site writes.
 *
 * Only the routes the screens use pass, spelled exactly, made of plain segments. Everything else is a 404,
 * so the routes that hand out tokens (sign-in, kiosk pairing) can never be reached from a page, whatever the spelling;
 * those go through /api/session and /api/kiosk-session, which keep the token in a cookie.
 */
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ALLOWED: [string, RegExp][] = [
  ['GET', /^site$/],
  ['GET', /^auth\/me$/],
  ['POST', /^auth\/password$/],
  ['POST', /^auth\/two-step\/(start|confirm|off)$/],
  ['GET', /^visits$/],
  ['GET', new RegExp(`^visits/${ID}$`)],
  ['POST', /^visits\/downloaded$/],
  ['POST', /^drivers$/],
  ['POST', new RegExp(`^visits/${ID}/(dock-clear|dock-reopen|release)$`)],
  ['POST', /^kiosk\/check-in$/],
  ['GET', /^team\/(accounts|kiosks|history|history\/check|summary|sessions)$/],
  ['POST', /^team\/(accounts|kiosks|history\/compare|export|sessions\/end-all)$/],
  ['PATCH', /^team\/site$/],
  ['PATCH', new RegExp(`^team/accounts/${ID}$`)],
  ['POST', new RegExp(`^team/accounts/${ID}/(reset-password|reset-two-step)$`)],
  ['POST', new RegExp(`^team/kiosks/${ID}/(new-code|retire)$`)],
  ['POST', new RegExp(`^team/sessions/${ID}/end$`)],
  ['POST', new RegExp(`^team/visits/${ID}/erase$`)],
];

function allowed(method: string, path: string[]) {
  if (!path.every((p) => /^[a-z0-9-]{1,64}$/.test(p))) return false; // plain lower-case segments only
  const joined = path.join('/');
  return ALLOWED.some(([m, re]) => m === method && re.test(joined));
}

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!allowed(req.method, path) || /[^\x21-\x7e]/.test(req.nextUrl.search)) {
    return NextResponse.json({ message: 'Not found' }, { status: 404 });
  }
  if (req.method !== 'GET') {
    const origin = req.headers.get('origin');
    if (!origin || new URL(origin).host !== req.headers.get('host')) {
      return NextResponse.json({ message: 'Refused: request did not come from this site' }, { status: 403 });
    }
  }
  const jar = await cookies();
  const token = jar.get(path[0] === 'kiosk' ? KIOSK_COOKIE : STAFF_COOKIE)?.value;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  Object.assign(headers, forwardedFor(req));

  const res = await fetch(`${API_URL}/api/${path.join('/')}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' ? undefined : await req.text(),
    cache: 'no-store',
  });
  return new NextResponse(await res.text(), { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export { forward as GET, forward as POST, forward as PATCH, forward as PUT, forward as DELETE };
