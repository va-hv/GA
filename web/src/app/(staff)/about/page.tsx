import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Plate, Stamp } from '@/components/kit';
import { Barrier, Dock, Hardhat, Key, Person, Tablet, Truck } from '@/components/glyphs';
import { staffOnly } from '@/lib/server';

export const metadata = { title: 'About' };

/** Keep these in step with the README after each test run. */
const TESTS = { db: 180, e2e: 132, checkedOn: '14 Nov 2026' };

const SECTIONS = [
  { id: 'business', text: 'What it does' },
  { id: 'data', text: 'Data architecture' },
  { id: 'security', text: 'Security' },
];

export default async function AboutPage() {
  const me = await staffOnly();
  if (me.role !== 'admin') redirect('/yard');
  return (
    <div className="mx-auto max-w-5xl space-y-12 pb-16">
      <header className="space-y-3">
        <p className="tag">About Gatehouse</p>
        <h1 className="text-4xl font-black tracking-tight">What it does, how its data is kept, and how it is protected</h1>
        <p className="max-w-3xl text-lg text-ink-2">
          A plain description of the app as it is today. Where something is not built yet, it says so.
        </p>
        <nav aria-label="On this page" className="flex flex-wrap gap-2 pt-1">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-md border-2 border-rule px-3 py-1.5 text-sm font-extrabold uppercase tracking-wider text-ink-2 hover:border-ink hover:text-ink">{s.text}</a>
          ))}
        </nav>
      </header>

      <Business />
      <Data />
      <Security />
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- */

function H2({ id, kicker, children }: { id: string; kicker: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-6 border-b-4 border-ink pb-2">
      <p className="tag">{kicker}</p>
      <h2 className="text-3xl font-black tracking-tight">{children}</h2>
    </div>
  );
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border-2 border-rule bg-sheet p-4 ${className}`}>{children}</div>;
}

/* ---------------------------------------------------------------------------------------------------------------- */

const ROLES = [
  { Icon: Tablet, who: 'Visitors and contractors', where: 'Reception tablet', can: [
    'Sign themselves in: name, email, phone, who they are visiting, why',
    'Contractors add their company and insurance number',
    'Optional photo from the tablet camera; tick that ID was shown',
    'Read and accept the site’s safety rules before getting in',
  ] },
  { Icon: Barrier, who: 'Security', where: 'Gate', can: [
    'Check drivers in: licence, carrier and SCAC, plate, truck and appointment numbers, trailer and seal IN',
    'Handle bobtails (no trailer) and empty trailers (no seal)',
    'See which trucks the dock has cleared, compare trailer and seal, then release or correct',
    'Check visitors and contractors out',
  ] },
  { Icon: Dock, who: 'Dock coordinator', where: 'Dock office', can: [
    'See trucks only, never visitors',
    'Clear a truck going out empty, or loaded with trailer and seal OUT',
    'Withdraw a clearance until the truck has left',
  ] },
  { Icon: Key, who: 'Site admin', where: 'Office', can: [
    'Add people, set roles, deactivate, give temporary passwords',
    'Pair and retire reception tablets',
    'Change the site name, safety rules and kiosk note',
    'See who is signed in and sign anyone out; reset a lost two-step sign-in',
    'Set how long photos and personal details are kept; erase one person’s details on request',
    'Check the history for tampering, keep its fingerprint, and export all data',
  ] },
];

const RULES = [
  'A driver cannot leave before the dock clears the truck.',
  'The same truck cannot be on site twice at once.',
  'Bobtail: no trailer or seal. Loaded trailer: a seal. Empty trailer: no seal.',
  'Leaving loaded needs trailer and seal OUT; leaving empty needs neither.',
  'Arrival details never change after check-in. A visit that has left is closed.',
  'Visits are never deleted. Only personal details are removed, after the site’s chosen period or on request, and that is recorded.',
  'Every change is recorded with who and when.',
];

function Business() {
  return (
    <section className="space-y-6">
      <H2 id="business" kicker="Business view">What it does today</H2>
      <p className="max-w-3xl text-ink-2">
        Gatehouse keeps one live answer to three questions at a warehouse gate: who is on site, which trucks the dock has
        cleared, and who has left. It replaces the paper logbook and the radio call between dock and gate.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {ROLES.map(({ Icon, who, where, can }) => (
          <Card key={who}>
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-ink text-paper"><Icon /></span>
              <div><p className="text-lg font-extrabold leading-tight">{who}</p><p className="text-sm text-ink-2">{where}</p></div>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {can.map((c) => <li key={c} className="flex gap-2"><span className="text-signal">■</span><span>{c}</span></li>)}
            </ul>
          </Card>
        ))}
      </div>

      <div>
        <p className="text-lg font-extrabold">A truck&apos;s day</p>
        <ol className="mt-3 grid gap-3 md:grid-cols-3">
          {[
            ['1', 'Security checks it in', 'Plate, trailer and seal IN are recorded. It shows at the dock.', <Stamp key="s" kind="dock" />],
            ['2', 'The dock clears it', 'Going empty, or loaded with trailer and seal OUT. It shows at the gate.', <Stamp key="s" kind="cleared" />],
            ['3', 'Security releases it', 'Trailer and seal are compared with the truck; corrections are recorded.', <Stamp key="s" kind="out" />],
          ].map(([n, title, text, stamp]) => (
            <li key={n as string} className="rounded-lg border-2 border-rule bg-sheet p-4">
              <div className="flex items-center justify-between"><span className="font-mono text-3xl font-black text-signal">{n}</span>{stamp}</div>
              <p className="mt-2 font-extrabold">{title}</p>
              <p className="text-sm text-ink-2">{text}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <p className="text-lg font-extrabold">Rules it will not bend</p>
          <ul className="mt-2 space-y-1.5 text-sm">{RULES.map((r) => <li key={r} className="flex gap-2"><span className="font-bold text-go">✓</span><span>{r}</span></li>)}</ul>
          <p className="mt-3 text-xs text-ink-2">These live in the database, so no screen, mistake or shortcut can skip them.</p>
        </Card>
        <Card>
          <p className="text-lg font-extrabold">Not built yet</p>
          <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
            {[
              'Telling the host by email or text when their visitor arrives',
              'Reading an ID card or driver’s licence automatically (today: a tick box)',
              'Appointment list or yard map (which door, which trailer spot)',
              'Single sign-on with the company’s Microsoft or Google accounts',
              'Backups running nightly by themselves (today: one command, or one line added to the server’s schedule)',
              'Reports beyond the daily log, the overview numbers and the export',
            ].map((r) => <li key={r} className="flex gap-2"><span>○</span><span>{r}</span></li>)}
          </ul>
        </Card>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- */

function Box({ title, sub, children, accent }: { title: string; sub: string; children?: ReactNode; accent?: boolean }) {
  return (
    <div className={`rounded-lg border-2 p-3 ${accent ? 'border-signal bg-signal-soft' : 'border-ink bg-sheet'}`}>
      <p className="font-extrabold leading-tight">{title}</p>
      <p className="text-xs text-ink-2">{sub}</p>
      {children && <ul className="mt-2 space-y-1 text-xs">{children}</ul>}
    </div>
  );
}
const Li = ({ children }: { children: ReactNode }) => <li className="flex gap-1.5"><span className="text-signal">›</span><span>{children}</span></li>;
const Arrow = ({ label }: { label: string }) => (
  <div className="flex items-center justify-center gap-2 py-1 text-xs font-bold text-ink-2 md:flex-col md:py-0">
    <span className="md:hidden">↓</span><span className="hidden md:inline text-lg">→</span><span className="text-center">{label}</span>
  </div>
);

const TABLES: { name: string; what: string; cols: string; reads: string; tone?: 'secret' | 'append' }[] = [
  { name: 'base.orgs', what: 'Each site', cols: 'name', reads: 'Its own people and tablet' },
  { name: 'base.site_settings', what: 'Site wording', cols: 'safety rules, driver note, kiosk note', reads: 'Its own people and tablet' },
  { name: 'base.accounts', what: 'Staff logins', cols: 'username, name, role, active, password hash, two-step secret', reads: 'Admins of the site (never the hash or secret)' },
  { name: 'base.kiosks', what: 'Reception tablets', cols: 'label, paired, retired, pairing code (hashed)', reads: 'Admins of the site' },
  { name: 'base.sessions', what: 'Who is signed in', cols: 'token (hashed), person or tablet, expiry', reads: 'Nobody directly', tone: 'secret' },
  { name: 'base.sign_in_failures', what: 'Lockout counter', cols: 'username, address, failures', reads: 'Nobody directly', tone: 'secret' },
  { name: 'gate.visits', what: 'Every person and truck', cols: 'who, contact, truck, trailer and seal in/out, times, by whom, photo; personal details removed after the retention period', reads: 'Staff of the site; dock sees drivers only', tone: 'append' },
  { name: 'base.history', what: 'Every change', cols: 'when, who, what, details, chain hash', reads: 'Admins of the site', tone: 'append' },
];

function Data() {
  return (
    <section className="space-y-6">
      <H2 id="data" kicker="Data architecture">How the data flows and where it lives</H2>

      <div>
        <p className="text-lg font-extrabold">The path of every request</p>
        <div className="mt-3 grid items-stretch gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1.2fr]">
          <Box title="Screens" sub="Browser, tablet or phone">
            <Li>Staff pages and the kiosk</Li><Li>Holds no password or token it can read</Li>
          </Box>
          <Arrow label="HTTPS" />
          <Box title="Web app" sub="Next.js">
            <Li>Session in an httpOnly cookie</Li><Li>Refuses changes from other websites</Li><Li>Never passes tokens to the page</Li>
          </Box>
          <Arrow label="token" />
          <Box title="API" sub="NestJS">
            <Li>Checks every form field</Li><Li>Checks the role on every route</Li><Li>Hands the database only the token</Li>
          </Box>
          <Arrow label="token" />
          <Box title="Database" sub="PostgreSQL 16" accent>
            <Li>Finds who the token belongs to</Li><Li>Shows only that site&apos;s rows</Li><Li>Every change through a rule function</Li><Li>Writes the history</Li>
          </Box>
        </div>
        <p className="mt-2 text-sm text-ink-2">
          The database decides who is asking. The API cannot name a site, and its database login cannot write any table
          directly, so a mistake in the API cannot leak or change another site&apos;s data.
        </p>
      </div>

      <div>
        <p className="text-lg font-extrabold">What is stored</p>
        <div className="mt-3 rounded-xl border-2 border-dashed border-rule-strong p-3">
          <p className="tag mb-2">One site · every row below carries its site, and rows of other sites are invisible</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {TABLES.map((t) => (
              <div key={t.name} className={`rounded-lg border-2 bg-sheet p-3 ${t.tone === 'secret' ? 'border-stop/60' : t.tone === 'append' ? 'border-info' : 'border-rule'}`}>
                <p className="font-mono text-xs font-bold">{t.name}</p>
                <p className="font-extrabold leading-tight">{t.what}</p>
                <p className="mt-1 text-xs text-ink-2">{t.cols}</p>
                <p className="mt-2 text-xs"><span className="font-bold">Read by:</span> {t.reads}</p>
                {t.tone === 'append' && <p className="mt-1 text-xs font-bold text-info">Records never deleted</p>}
                {t.tone === 'secret' && <p className="mt-1 text-xs font-bold text-stop">Hidden from the app</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <p className="text-lg font-extrabold">The life of a visit</p>
        <figure className="mt-3 rounded-lg border-2 border-rule bg-sheet p-4">
          <svg viewBox="0 0 720 220" role="img" aria-labelledby="life-title" className="h-auto w-full">
            <title id="life-title">Drivers go from at the dock, to cleared, to left; the dock can send a cleared truck back. Visitors and contractors go from on site to left.</title>
            <defs>
              <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" fill="var(--ink)" />
              </marker>
            </defs>
            {[
              { x: 20, y: 30, w: 170, label: 'At the dock', sub: 'driver checked in', stroke: 'var(--info)' },
              { x: 290, y: 30, w: 170, label: 'Cleared · to gate', sub: 'dock signed off', stroke: 'var(--wait)' },
              { x: 540, y: 95, w: 160, label: 'Left', sub: 'closed for good', stroke: 'var(--ink-2)' },
              { x: 20, y: 160, w: 170, label: 'On site', sub: 'visitor or contractor', stroke: 'var(--info)' },
            ].map((n) => (
              <g key={n.label}>
                <rect x={n.x} y={n.y} width={n.w} height="48" rx="6" fill="var(--sheet-2)" stroke={n.stroke} strokeWidth="2.5" />
                <text x={n.x + n.w / 2} y={n.y + 21} textAnchor="middle" fontSize="15" fontWeight="800" fill="var(--ink)">{n.label}</text>
                <text x={n.x + n.w / 2} y={n.y + 38} textAnchor="middle" fontSize="11" fill="var(--ink-2)">{n.sub}</text>
              </g>
            ))}
            <path d="M190 46 H288" stroke="var(--ink)" strokeWidth="2" markerEnd="url(#ah)" fill="none" />
            <text x="239" y="38" textAnchor="middle" fontSize="11" fill="var(--ink)" fontWeight="700">dock clears</text>
            <path d="M290 66 C 250 100, 220 100, 190 70" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="5 4" markerEnd="url(#ah)" fill="none" />
            <text x="240" y="108" textAnchor="middle" fontSize="11" fill="var(--ink-2)">dock withdraws</text>
            <path d="M460 60 C 500 60, 520 90, 540 110" stroke="var(--ink)" strokeWidth="2" markerEnd="url(#ah)" fill="none" />
            <text x="548" y="84" textAnchor="start" fontSize="11" fill="var(--ink)" fontWeight="700">gate releases</text>
            <path d="M190 184 C 380 184, 470 160, 540 130" stroke="var(--ink)" strokeWidth="2" markerEnd="url(#ah)" fill="none" />
            <text x="360" y="200" textAnchor="middle" fontSize="11" fill="var(--ink)" fontWeight="700">security checks out</text>
          </svg>
          <figcaption className="mt-2 text-sm text-ink-2">
            Only these moves exist. A truck at the dock has no path to &quot;Left&quot; except through the dock&apos;s clearance.
          </figcaption>
        </figure>
      </div>

      <Card>
        <p className="text-lg font-extrabold">What a truck record holds</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Truck /> <span>Maple Freight · Dan Driver</span> <Plate>BX42 719</Plate>
          <span className="text-ink-2">trailer</span> <Plate dim>LKS-5301</Plate> <span className="text-ink-2">seal in</span> <Plate dim>SL-883410</Plate>
          <span className="text-ink-2">→ out</span> <Plate>SL-994017</Plate>
        </div>
        <p className="mt-2 text-sm text-ink-2">
          Plus phone, licence, SCAC, vehicle type, appointment and truck numbers, Live or Drop, and the time and person for
          check-in, dock clearance and release. Visitor records hold contact details, host, purpose, insurance number for
          contractors, and an optional photo (photos are only sent when one record is opened, and never in exports).
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-2"><span className="flex items-center gap-1"><Person width={16} /> visitor</span><span className="flex items-center gap-1"><Hardhat width={16} /> contractor</span></div>
      </Card>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- */

const CONTROLS: { area: string; what: string; stops: string; where: string }[] = [
  { area: 'Sites kept apart', what: 'Row-level security on every table; the database works out the site from the session', stops: 'One customer seeing or changing another’s data', where: 'Database' },
  { area: 'Roles', what: 'Checked on every API route and again inside every database rule', stops: 'Dock releasing trucks, security managing people, the tablet reading the log', where: 'API + database' },
  { area: 'No back door for the app', what: 'The app’s database login cannot bypass the rules or write tables; only rule functions can change data', stops: 'A bug or injected query rewriting records', where: 'Database' },
  { area: 'Passwords', what: 'bcrypt hashes; 10+ characters with letters and numbers; temporary passwords must be replaced at first sign-in', stops: 'Stolen hashes being reversed; shared starter passwords', where: 'Database' },
  { area: 'Two-step sign-in', what: 'A 6-digit code from an authenticator app after the password; required for admins unless a site turns it off; a code works once; a wrong code counts toward the lockout', stops: 'A stolen or guessed password being enough to get in', where: 'Database' },
  { area: 'Guessing', what: 'Five wrong passwords or codes lock that account at that address for five minutes; an extra limit per address; the same answer for unknown names. Addresses come from the HTTPS proxy in front', stops: 'Password guessing and finding out who has an account', where: 'Database + API' },
  { area: 'Sessions', what: 'Random tokens stored only as hashes; 12-hour expiry; ended on sign-out, password change, reset, role change or deactivation', stops: 'A leaked database revealing live sessions; ex-staff staying signed in', where: 'Database' },
  { area: 'Browser', what: 'Token in an httpOnly cookie the page cannot read; the routes that hand out tokens are closed to pages; changes only accepted from this site; a content security policy that loads nothing from other sites; no framing', stops: 'Session theft by scripts, cross-site form tricks, clickjacking', where: 'Web app' },
  { area: 'Tablets', what: 'Paired with a one-time code that expires in 30 minutes; a tablet can only check people in (six a minute at most) and reads nothing', stops: 'A stolen tablet browsing records or flooding the log; anyone on the internet posting fake visitors', where: 'Database + API' },
  { area: 'Records', what: 'Arrival details cannot change, closed visits are frozen, nothing can be deleted', stops: 'Quietly fixing the log after the fact', where: 'Database' },
  { area: 'History', what: 'Append-only and hash-chained. The check catches edits made outside the app. Keep the fingerprint the console shows (it is also in every export) and a later comparison catches even a rewritten or shortened chain', stops: 'Undetected tampering; with a saved fingerprint, also by someone with access to the server', where: 'Database' },
  { area: 'Copies of the data', what: 'The full export is for admins only, without photos or hashes. Every export and every log download is recorded. Security and the dock see 31 days back at most. CSV cells cannot run as formulas', stops: 'Silent bulk copying; spreadsheet formula attacks', where: 'Database + API + web app' },
  { area: 'Privacy', what: 'Photos, and names, contact and ID numbers, are removed after the periods the site sets (30 days and a year by default), counted from when someone left or, if nobody checked them out, from when they arrived; an admin can erase one person on request; names are kept out of the history', stops: 'Keeping personal data longer than needed', where: 'Database' },
  { area: 'Network', what: 'Every port listens on this machine only; HTTPS comes from a proxy in front', stops: 'The database or API being reachable from the internet', where: 'Server' },
];

const LIMITS = [
  'Not yet tested by an outside security firm.',
  'No company single sign-on yet.',
  'HTTPS depends on the proxy in front being set up (then COOKIE_SECURE is switched on).',
  'Backups are encrypted and test-restored by a command; running them nightly is one line in the server’s schedule.',
  'Visitor photos stay in the database until the site’s photo period ends.',
  'Whoever runs the server can read everything. The history fingerprint shows changes; it cannot prevent them.',
  'User names are unique across all sites, so adding an account can show that a name is already taken elsewhere.',
];

function Security() {
  return (
    <section className="space-y-6">
      <H2 id="security" kicker="Security">How secure it is</H2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><p className="tag">Database rule checks</p><p className="font-mono text-4xl font-black text-go">{TESTS.db}</p><p className="text-xs text-ink-2">all passing, {TESTS.checkedOn}</p></Card>
        <Card><p className="tag">End-to-end checks</p><p className="font-mono text-4xl font-black text-go">{TESTS.e2e}</p><p className="text-xs text-ink-2">every role and site boundary, through the API and the website, {TESTS.checkedOn}</p></Card>
        <Card><p className="tag">Built in at</p><p className="text-2xl font-black">The database</p><p className="text-xs text-ink-2">rules hold even if a screen or the API is wrong</p></Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {CONTROLS.map((c) => (
          <div key={c.area} className="rounded-lg border-2 border-rule bg-sheet p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-lg font-extrabold leading-tight">{c.area}</p>
              <span className="whitespace-nowrap rounded-sm border-2 border-go px-1.5 py-0.5 text-[0.68rem] font-extrabold uppercase tracking-[0.1em] text-go">{c.where}</span>
            </div>
            <p className="mt-2 text-sm">{c.what}</p>
            <p className="mt-2 text-sm text-ink-2"><span className="font-bold text-ink">Stops: </span>{c.stops}</p>
          </div>
        ))}
      </div>

      <Card className="border-wait">
        <p className="text-lg font-extrabold text-wait">Honest limits today</p>
        <ul className="mt-2 space-y-1.5 text-sm">{LIMITS.map((l) => <li key={l} className="flex gap-2"><span className="font-bold text-wait">!</span><span>{l}</span></li>)}</ul>
      </Card>
    </section>
  );
}
