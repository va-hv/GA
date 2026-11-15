// End-to-end tests against the running API (`make up`, then `make e2e`). Creates two throwaway test sites with
// made-up people, walks every role through its job, and checks every role boundary and site boundary.
// Prints "ALL n PASSED" or the failures, and exits non-zero on any failure.
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL ?? 'http://127.0.0.1:3601';
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:3600';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Never against real data: these tests create throwaway sites and people.
{
  const { readFileSync, existsSync } = await import('node:fs');
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile) && /^INSTANCE=production\s*$/m.test(readFileSync(envFile, 'utf8'))) {
    console.error('Refused: this is a production install (INSTANCE=production in .env). The end-to-end tests create test data.');
    process.exit(1);
  }
}
const sfx = randomBytes(3).toString('hex');
const PW = `E2e-Start-${sfx}1`;
const PW2 = `E2e-Second-${sfx}2`;

const results = [];

// Authenticator-app codes (RFC 6238), to test two-step sign-in.
function base32(s) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '')) bits += abc.indexOf(ch).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, at = Date.now()) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', base32(secret)).update(msg).digest();
  const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
const expect = (name, ok, info = '') => results.push({ name, ok: !!ok, info });

function compose() {
  try { execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' }); return ['docker', ['compose']]; }
  catch { return ['docker-compose', []]; }
}
function sql(statement) {
  const [cmd, pre] = compose();
  return execFileSync(cmd, [...pre, 'exec', '-T', 'db', 'sh', '-c',
    'psql -X -q -tA -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
    { cwd: ROOT, input: statement, encoding: 'utf8' }).trim();
}

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: data };
}
const get = (p, t) => call('GET', p, t);
const post = (p, t, b = {}) => call('POST', p, t, b);
const patch = (p, t, b) => call('PATCH', p, t, b);

async function signIn(page, username, password) {
  const r = await post('/api/auth/sign-in', null, { page, username, password });
  return r;
}

const driver = (plate, extra = {}) => ({
  fullName: 'Ezra Test Driver', phone: '+1 416 555 0100', driverLicense: 'E2E-LIC-1', companyName: 'Test Haulers',
  scacCode: 'tsth', vehicleType: '53" Trailer', truckLicensePlate: plate, truckNumber: '42', appointmentNumber: 'APT-E2E',
  visitReason: 'Inbound', purpose: 'Live', bobtail: false, trailerNoIn: 'TR-E2E', arrivedEmpty: false, sealNoIn: 'SL-E2E',
  safetyAccepted: true, ...extra,
});
const visitor = (extra = {}) => ({
  role: 'VISITOR', fullName: 'Vic Test Visitor', email: 'vic@example.com', phone: '416-555-0111', purpose: 'Meeting',
  hostName: 'Someone', safetyAccepted: true, ...extra,
});

async function main() {
  // Two sites, created the way the owner's onboarding command does it.
  const adminA = `e2e-${sfx}-admin-a`, adminB = `e2e-${sfx}-admin-b`;
  sql(`SELECT base.create_site('E2E site A ${sfx}', '${adminA}', 'Ann Admin', '${PW}');
       SELECT base.create_site('E2E site B ${sfx}', '${adminB}', 'Ben Admin', '${PW}');
       UPDATE base.accounts SET must_change_password = false WHERE username = '${adminB}';
       UPDATE base.site_settings SET require_two_step_admins = false
        WHERE org_id = (SELECT org_id FROM base.accounts WHERE username = '${adminB}');`);

  expect('health answers', (await get('/api/health')).body?.ok === true);
  expect('no token: 401', (await get('/api/visits')).status === 401);
  expect('made-up token: 401', (await get('/api/visits', 'x'.repeat(43))).status === 401);

  // --- Admin: first sign-in, must change password -----------------------------------------------------------
  expect('wrong password: 401', (await signIn('admin', adminA, 'nope-nope-1')).status === 401);
  const wrongPage = await signIn('security', adminA, PW);
  expect('right password on the wrong page: 403 says which page', wrongPage.status === 403 && wrongPage.body?.code === 'WRONG_PAGE' && /Admin/.test(wrongPage.body?.message));
  let r = await signIn('admin', adminA, PW);
  expect('admin signs in, must change password', r.status === 200 && r.body.mustChange === true && r.body.token?.length > 30);
  const tAdmin = r.body.token;
  r = await get('/api/team/accounts', tAdmin);
  expect('before the change: everything else refused', r.status === 403 && r.body?.code === 'PASSWORD_CHANGE_REQUIRED');
  r = await get('/api/auth/me', tAdmin);
  expect('"me" works during the change', r.status === 200 && r.body.role === 'admin' && r.body.site.startsWith('E2E site A'));
  r = await post('/api/auth/password', tAdmin, { currentPassword: PW, newPassword: 'short' });
  expect('weak new password: 400 on the field', r.status === 400 && r.body?.fieldErrors?.newPassword);
  r = await post('/api/auth/password', tAdmin, { currentPassword: 'wrong-one-1', newPassword: PW2 });
  expect('wrong current password: 400 on the field', r.status === 400 && r.body?.fieldErrors?.currentPassword);
  r = await post('/api/auth/password', tAdmin, { currentPassword: PW, newPassword: PW2 });
  expect('admin changes password', r.status === 200);
  r = await get('/api/team/accounts', tAdmin);
  expect('then the admin must set up two-step sign-in', r.status === 403 && r.body?.code === 'TWO_STEP_SETUP_REQUIRED');
  expect('"me" says so', (await get('/api/auth/me', tAdmin)).body?.mustSetUpTwoStep === true);
  r = await post('/api/auth/two-step/start', tAdmin);
  expect('two-step set-up gives a key and an authenticator link', r.status === 200 && r.body.secret?.length === 32 && r.body.uri?.startsWith('otpauth://totp/'));
  const secretA = r.body.secret;
  expect('a wrong code does not turn it on', (await post('/api/auth/two-step/confirm', tAdmin, { code: '000000' })).status === 400);
  expect('the right code turns it on', (await post('/api/auth/two-step/confirm', tAdmin, { code: totp(secretA) })).status === 200);
  expect('then the admin screens open', (await get('/api/team/accounts', tAdmin)).status === 200);
  r = await signIn('admin', adminA, PW2);
  expect('signing in again asks for the code', r.status === 401 && r.body?.code === 'TWO_STEP_REQUIRED');
  r = await post('/api/auth/sign-in', null, { page: 'admin', username: adminA, password: PW2, code: '000000' });
  expect('a wrong code is refused', r.status === 401 && r.body?.code !== 'TWO_STEP_REQUIRED');
  r = await post('/api/auth/sign-in', null, { page: 'admin', username: adminA, password: PW2, code: totp(secretA, Date.now() + 30000) });
  expect('password and the next code sign in', r.status === 200 && r.body.token);
  expect('an admin cannot turn two-step off while the site requires it', (await post('/api/auth/two-step/off', tAdmin, { currentPassword: PW2 })).status === 400);

  // --- Admin adds the team -----------------------------------------------------------------------------------
  const secUser = `e2e-${sfx}-sec`, dockUser = `e2e-${sfx}-dock`;
  r = await post('/api/team/accounts', tAdmin, { username: secUser, fullName: 'Sid Security', role: 'security', password: PW });
  expect('admin adds a security account', r.status === 201 && r.body.id);
  r = await post('/api/team/accounts', tAdmin, { username: dockUser, fullName: 'Dot Dock', role: 'dock', password: PW });
  expect('admin adds a dock account', r.status === 201);
  const dockId = r.body.id;
  r = await post('/api/team/accounts', tAdmin, { username: secUser, fullName: 'Again', role: 'security', password: PW });
  expect('same username again: 409 on the field', r.status === 409 && r.body?.fieldErrors?.username);
  r = await post('/api/team/accounts', tAdmin, { username: `e2e-${sfx}-x`, fullName: 'X', role: 'owner', password: PW });
  expect('unknown role: 400', r.status === 400 && r.body?.fieldErrors?.role);

  async function firstSignIn(page, user) {
    const a = await signIn(page, user, PW);
    await post('/api/auth/password', a.body?.token, { currentPassword: PW, newPassword: PW2 });
    return a.body?.token;
  }
  const tSec = await firstSignIn('security', secUser);
  const tDock = await firstSignIn('dock', dockUser);
  expect('security and dock sign in and set passwords', (await get('/api/visits', tSec)).status === 200 && (await get('/api/visits', tDock)).status === 200);

  // --- Kiosk --------------------------------------------------------------------------------------------------
  r = await post('/api/team/kiosks', tAdmin, { label: 'E2E lobby' });
  expect('admin adds a kiosk and gets a code', r.status === 201 && r.body.code?.length === 10);
  const kioskId = r.body.id, code = r.body.code;
  expect('wrong pairing code: 401', (await post('/api/kiosk/pair', null, { code: 'ZZZZZZZZZZ' })).status === 401);
  r = await post('/api/kiosk/pair', null, { code });
  expect('tablet pairs with the code', r.status === 200 && r.body.token && r.body.label === 'E2E lobby');
  const tKiosk = r.body.token;
  expect('code works only once', (await post('/api/kiosk/pair', null, { code })).status === 401);
  r = await get('/api/auth/me', tKiosk);
  expect('kiosk knows its site', r.status === 200 && r.body.role === 'kiosk' && r.body.site.startsWith('E2E site A'));
  r = await post('/api/kiosk/check-in', tKiosk, visitor());
  expect('visitor checks in at the kiosk', r.status === 201 && r.body.kind === 'visitor');
  const visitorId = r.body.id;
  r = await post('/api/kiosk/check-in', tKiosk, visitor({ email: '' }));
  expect('kiosk: missing email: 400 on the field', r.status === 400 && r.body?.fieldErrors?.email);
  r = await post('/api/kiosk/check-in', tKiosk, visitor({ role: 'CONTRACTOR', companyName: 'Fixers' }));
  expect('kiosk: contractor without insurance: 400', r.status === 400 && r.body?.fieldErrors?.insuranceNumber);
  r = await post('/api/kiosk/check-in', tKiosk, visitor({ safetyAccepted: false }));
  expect('kiosk: safety not accepted: 400', r.status === 400 && r.body?.fieldErrors?.safetyAccepted);
  expect('kiosk cannot read the log', (await get('/api/visits', tKiosk)).status === 403);
  expect('kiosk cannot check a driver in', (await post('/api/drivers', tKiosk, driver('KIOSK1'))).status === 403);
  expect('security cannot use the kiosk route', (await post('/api/kiosk/check-in', tSec, visitor())).status === 403);

  // --- Drivers: in, dock, out ---------------------------------------------------------------------------------
  const plate = `E2E ${sfx}`.toUpperCase();
  r = await post('/api/drivers', tSec, driver(plate.toLowerCase()));
  expect('security checks a driver in', r.status === 201 && r.body.id);
  const truckId = r.body.id;
  r = await post('/api/drivers', tSec, driver(plate));
  expect('same truck twice: 409 on the plate', r.status === 409 && r.body?.fieldErrors?.truckLicensePlate);
  r = await post('/api/drivers', tSec, driver(`${plate}-2`, { sealNoIn: '' }));
  expect('loaded without a seal: 400 on the field', r.status === 400 && r.body?.fieldErrors?.sealNoIn);
  r = await post('/api/drivers', tSec, driver(`${plate}-3`, { scacCode: 'T1' }));
  expect('bad SCAC: 400 on the field', r.status === 400 && r.body?.fieldErrors?.scacCode);
  expect('dock cannot check a driver in', (await post('/api/drivers', tDock, driver(`${plate}-4`))).status === 403);
  expect('admin cannot check a driver in', (await post('/api/drivers', tAdmin, driver(`${plate}-5`))).status === 403);
  r = await post(`/api/visits/${truckId}/release`, tSec);
  expect('driver cannot leave before the dock clears: 409', r.status === 409 && /Dock coordinator/.test(r.body?.message));

  r = await get('/api/visits', tDock);
  expect('dock sees drivers only', r.status === 200 && r.body.length > 0 && r.body.every((v) => v.kind === 'driver'));
  expect('dock cannot open a visitor', (await get(`/api/visits/${visitorId}`, tDock)).status === 404);
  r = await post(`/api/visits/${truckId}/dock-clear`, tDock, { goingEmpty: false, trailerNoOut: 'TR-OUT' });
  expect('dock: loaded without seal OUT: 400 on the field', r.status === 400 && r.body?.fieldErrors?.sealNoOut);
  expect('security cannot clear at the dock', (await post(`/api/visits/${truckId}/dock-clear`, tSec, { goingEmpty: true })).status === 403);
  r = await post(`/api/visits/${truckId}/dock-clear`, tDock, { goingEmpty: false, trailerNoOut: 'TR-OUT', sealNoOut: 'SL-OUT' });
  expect('dock clears the truck', r.status === 200);
  r = await post(`/api/visits/${truckId}/dock-reopen`, tDock);
  expect('dock withdraws the clearance', r.status === 200);
  r = await post(`/api/visits/${truckId}/dock-clear`, tDock, { goingEmpty: false, trailerNoOut: 'TR-OUT', sealNoOut: 'SL-OUT' });
  expect('dock clears it again', r.status === 200);
  r = await get(`/api/visits/${truckId}`, tSec);
  expect('security sees it cleared at the dock', r.body?.status === 'dock_cleared' && r.body?.dockClearedBy === 'Dot Dock');
  expect('dock cannot release at the gate', (await post(`/api/visits/${truckId}/release`, tDock)).status === 403);
  r = await post(`/api/visits/${truckId}/release`, tSec, { sealNoOut: 'SL-OUT-CHECKED' });
  expect('security releases with a corrected seal', r.status === 200);
  r = await get(`/api/visits/${truckId}`, tSec);
  expect('the corrected seal is kept', r.body?.status === 'left' && r.body?.sealNoOut === 'SL-OUT-CHECKED' && r.body?.trailerNoOut === 'TR-OUT');
  expect('cannot release twice: 409', (await post(`/api/visits/${truckId}/release`, tSec)).status === 409);
  expect('security checks the visitor out', (await post(`/api/visits/${visitorId}/release`, tSec)).status === 200);

  r = await get(`/api/visits?q=${encodeURIComponent(plate.toLowerCase())}&tz=America/Toronto`, tSec);
  expect('search by plate finds the truck', r.status === 200 && r.body.some((v) => v.id === truckId));
  r = await get('/api/visits?kind=visitor&status=left', tSec);
  expect('filters by kind and status', r.status === 200 && r.body.every((v) => v.kind === 'visitor' && v.status === 'left'));
  expect('bad id: 400', (await get('/api/visits/not-a-uuid', tSec)).status === 400);

  // --- Sites are separate -------------------------------------------------------------------------------------
  r = await signIn('admin', adminB, PW);
  const tAdminB = r.body?.token;
  expect('site B admin signs in', r.status === 200 && tAdminB);
  r = await get('/api/visits', tAdminB);
  expect('site B sees none of site A', r.status === 200 && !r.body.some((v) => v.id === truckId || v.id === visitorId));
  expect('site B cannot open site A visits', (await get(`/api/visits/${truckId}`, tAdminB)).status === 404);
  expect('site B cannot change site A accounts', (await patch(`/api/team/accounts/${dockId}`, tAdminB, { active: false })).status === 404);
  r = await get('/api/team/accounts', tAdminB);
  expect('site B lists only its own accounts', r.status === 200 && r.body.length === 1 && r.body[0].username === adminB);
  expect('site B cannot retire site A kiosk', (await post(`/api/team/kiosks/${kioskId}/retire`, tAdminB)).status === 404);

  // --- Admin console ------------------------------------------------------------------------------------------
  r = await get('/api/site', tKiosk);
  expect('kiosk reads its site wording', r.status === 200 && Array.isArray(r.body.safetyVisitor) && r.body.safetyVisitor.length > 0);
  expect('security reads the site wording', (await get('/api/site', tSec)).body?.safetyDriver?.length > 0);
  expect('security cannot change site settings', (await patch('/api/team/site', tSec, { name: 'Hacked' })).status === 403);
  r = await patch('/api/team/site', tAdmin, { name: `E2E site A ${sfx} renamed`, safetyVisitor: ['Wear the vest', '', 'Stay with your host'], kioskWelcome: 'Hi' });
  expect('admin changes name and wording', r.status === 200);
  r = await get('/api/site', tKiosk);
  expect('the kiosk sees the new wording at once', r.body?.safetyVisitor?.length === 2 && r.body.name.endsWith('renamed') && r.body.kioskWelcome === 'Hi');
  r = await patch('/api/team/site', tAdmin, { keepPhotoDays: 200, keepPersonalDays: 100 });
  expect('photos cannot outlive other details', r.status === 400);
  r = await get('/api/site', tAdmin);
  expect('retention defaults are 30 and 365 days, two-step required', r.body?.keepPhotoDays === 30 && r.body?.keepPersonalDays === 365 && r.body?.requireTwoStepAdmins === true);
  r = await patch('/api/team/site', tAdmin, { safetyVisitor: [] });
  expect('an empty safety list is refused on the field', r.status === 400 && r.body?.fieldErrors?.safetyVisitor);
  expect('nothing to change: 400', (await patch('/api/team/site', tAdmin, {})).status === 400);
  r = await get('/api/team/summary', tAdmin);
  expect('admin overview counts the site', r.status === 200 && r.body.people >= 3 && r.body.kiosks === 1 && r.body.visitsAllTime >= 2);
  expect('security cannot read the overview', (await get('/api/team/summary', tSec)).status === 403);
  r = await get('/api/team/sessions', tAdmin);
  expect('admin lists open sessions with "me" marked', r.status === 200 && r.body.filter((x) => x.isMe).length === 1 && r.body.some((x) => x.kind === 'kiosk'));
  const mine = r.body.find((x) => x.isMe);
  expect('admin cannot end own session there', (await post(`/api/team/sessions/${mine.id}/end`, tAdmin)).status === 400);
  r = await get('/api/team/history/check', tAdmin);
  expect('history check says intact', r.status === 200 && r.body.intact === true && r.body.entries > 5 && r.body.fingerprint?.length === 64);
  const fpA = r.body;
  r = await post('/api/team/history/compare', tAdmin, { entries: fpA.entries, fingerprint: fpA.fingerprint });
  expect('a saved fingerprint matches', r.status === 200 && r.body.matches === true);
  r = await post('/api/team/history/compare', tAdmin, { entries: fpA.entries, fingerprint: 'ab'.repeat(32) });
  expect('a different fingerprint does not', r.status === 200 && r.body.matches === false);
  expect('security cannot compare fingerprints', (await post('/api/team/history/compare', tSec, { entries: 1, fingerprint: 'ab'.repeat(32) })).status === 403);
  r = await post('/api/visits/downloaded', tSec, { day: '2026-11-14', rows: 3 });
  expect('a log download is recorded', r.status === 200 && (await get('/api/team/history', tAdmin)).body.some((h) => h.action === 'downloaded the log'));
  r = await get('/api/visits?date=2020-01-01', tSec);
  expect('security cannot read days long ago', r.status === 400 && r.body?.fieldErrors?.date);
  expect('admins can', (await get('/api/visits?date=2020-01-01', tAdmin)).status === 200);
  expect('security cannot erase details', (await post(`/api/team/visits/${visitorId}/erase`, tSec)).status === 403);
  r = await post(`/api/team/visits/${visitorId}/erase`, tAdmin);
  expect('admin erases a visitor on request', r.status === 200 && (await get(`/api/visits/${visitorId}`, tAdmin)).body?.fullName === 'Removed');
  expect('another site cannot erase it', (await post(`/api/team/visits/${truckId}/erase`, tAdminB)).status === 404);
  expect('the export cannot be started by a plain link (GET)', (await get('/api/team/export', tAdmin)).status === 404);
  r = await post('/api/team/export', tAdmin);
  expect('admin exports the whole site', r.status === 200 && r.body.visits.some((v) => v.id === truckId) && r.body.history.length > 5);
  expect('the export leaves out photos and password hashes',
    !JSON.stringify(r.body).includes('photoData') && !JSON.stringify(r.body).includes('password_hash') && !JSON.stringify(r.body).includes('passwordHash'));
  expect('the export is written to the history', (await get('/api/team/history', tAdmin)).body.some((h) => h.action === 'exported all site data'));
  expect('the export carries the history fingerprint', r.body.historyFingerprint?.fingerprint?.length === 64);
  expect('security cannot export', (await post('/api/team/export', tSec)).status === 403);
  r = await post('/api/team/export', tAdminB);
  expect('site B export holds nothing of site A', r.status === 200 && !r.body.visits.some((v) => v.id === truckId) && r.body.accounts.length === 1);

  // --- Admin powers and their limits --------------------------------------------------------------------------
  r = await get('/api/team/history', tAdmin);
  expect('admin reads the history', r.status === 200 && r.body.some((h) => h.action === 'released at gate'));
  expect('security cannot read the history', (await get('/api/team/history', tSec)).status === 403);
  expect('security cannot add accounts', (await post('/api/team/accounts', tSec, { username: 'zz-zz', fullName: 'Z', role: 'admin', password: PW })).status === 403);
  const me = (await get('/api/team/accounts', tAdmin)).body.find((a) => a.username === adminA);
  r = await patch(`/api/team/accounts/${me.id}`, tAdmin, { active: false });
  expect('admin cannot deactivate self', r.status === 400);
  r = await patch(`/api/team/accounts/${dockId}`, tAdmin, { active: false });
  expect('admin deactivates the dock account', r.status === 200);
  expect('deactivated person is out at once', (await get('/api/visits', tDock)).status === 401);
  let limited = false;
  for (let i = 0; i < 8 && !limited; i++) limited = (await post('/api/kiosk/check-in', tKiosk, visitor({ fullName: `Flood ${i}` }))).status === 429;
  expect('a kiosk cannot flood the log (six a minute)', limited);
  expect('admin retires the kiosk', (await post(`/api/team/kiosks/${kioskId}/retire`, tAdmin)).status === 200);
  expect('retired kiosk is out at once', (await post('/api/kiosk/check-in', tKiosk, visitor())).status === 401);

  // --- Signing out and lockout --------------------------------------------------------------------------------
  expect('sign out', (await post('/api/auth/sign-out', tSec)).status === 200);
  expect('signed-out token is refused', (await get('/api/visits', tSec)).status === 401);
  for (let i = 0; i < 5; i++) await signIn('security', secUser, 'wrong-password-1');
  r = await signIn('security', secUser, PW2);
  expect('five wrong passwords lock the account for a while', r.status === 403 && r.body?.code === 'LOCKED');

  // --- Sign everyone out ---------------------------------------------------------------------------------------
  const tSecAgain = (await signIn('admin', adminB, PW)).body?.token;
  r = await post('/api/team/sessions/end-all', tAdminB, {});
  expect('site B admin signs everyone else out', r.status === 200 && r.body.ended >= 1);
  expect('their other sessions end', (await get('/api/visits', tSecAgain)).status === 401);
  expect('the admin who did it stays in', (await get('/api/visits', tAdminB)).status === 200);
  expect('site A is untouched', (await get('/api/visits', tAdmin)).status === 200);

  // --- Through the website (port 3600): the browser's only way in -----------------------------------------------
  const web = (path, opts = {}) => fetch(WEB + path, { redirect: 'manual', ...opts, headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) } });
  const same = { origin: WEB };
  r = await web('/api/session', { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ page: 'admin', username: adminB, password: PW }) });
  expect('web: sign-in from another website is refused', r.status === 403);
  for (const path of ['/api/auth/sign-in', '/api/AUTH/sign-in', '/api/auth/Sign-In', '/api/Kiosk/pair', '/api/auth/sign-in/', '/api/kiosk/PAIR',
    '/api/auth/sign-in%20', '/api/auth/sign-%09in', '/api/au%0Ath/sign-in', '/api/kiosk/pa%0Dir', '/api/auth/sign-in%2f', '/api/health']) {
    r = await web(path, { method: 'POST', headers: same, body: JSON.stringify({ page: 'admin', username: adminB, password: PW, code: 'X' }) });
    // 404, or a redirect to the plain path (itself closed): either way it never reaches the API
    expect(`web: ${path} is closed to pages`, r.status === 404 || (r.status >= 300 && r.status < 400 && /\/api\/auth\/sign-in$/i.test(r.headers.get('location') ?? '')));
  }
  r = await web('/api/session', { method: 'POST', headers: { ...same, 'x-forwarded-for': '198.51.100.7' }, body: JSON.stringify({ page: 'admin', username: adminB, password: PW }) });
  const setCookie = r.headers.get('set-cookie') ?? '';
  const body = await r.json();
  expect('web: sign-in sets an httpOnly cookie and never shows the token', r.status === 200 && /HttpOnly/i.test(setCookie) && /SameSite=lax/i.test(setCookie) && !('token' in body) && !JSON.stringify(body).includes(setCookie.split(';')[0].split('=')[1]));
  const cookie = setCookie.split(';')[0];
  r = await web('/api/visits', { headers: { cookie } });
  expect('web: the cookie works for reading', r.status === 200);
  r = await web('/api/drivers', { method: 'POST', headers: { cookie, origin: 'https://evil.example' }, body: '{}' });
  expect('web: a change from another website is refused', r.status === 403);
  r = await web('/api/team/export', { method: 'POST', headers: { cookie }, body: '{}' });
  expect('web: a change with no origin at all is refused', r.status === 403);
  r = await web('/');
  const csp = r.headers.get('content-security-policy') ?? '';
  expect('web: content security policy and no framing', /default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && r.headers.get('x-frame-options') === 'DENY');
  const victim = `e2e-${sfx}-sec`;
  for (let i = 0; i < 5; i++) {
    await web('/api/session', { method: 'POST', headers: { ...same, 'x-forwarded-for': '198.51.100.66' }, body: JSON.stringify({ page: 'security', username: victim, password: 'wrong-password-9' }) });
  }
  r = await web('/api/session', { method: 'POST', headers: { ...same, 'x-forwarded-for': '198.51.100.66' }, body: JSON.stringify({ page: 'security', username: victim, password: PW2 }) });
  const lockedThere = r.status === 403;
  r = await web('/api/session', { method: 'POST', headers: { ...same, 'x-forwarded-for': '198.51.100.67' }, body: JSON.stringify({ page: 'security', username: victim, password: PW2 }) });
  expect('web: a stranger\'s wrong passwords lock only the stranger\'s address', lockedThere && r.status === 200);

  // --- Report -------------------------------------------------------------------------------------------------
  const failed = results.filter((x) => !x.ok);
  for (const f of failed) console.log(`FAILED: ${f.name} ${f.info}`);
  console.log(failed.length ? `${failed.length} of ${results.length} FAILED` : `ALL ${results.length} PASSED`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
