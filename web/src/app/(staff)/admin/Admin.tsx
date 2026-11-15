'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, Check, Empty, Field, Notice, SectionHead, Sheet, Stamp, cx } from '@/components/kit';
import { Problem, send } from '@/lib/client';
import { ROLE_NAMES, type Role } from '@/lib/types';

interface Account { id: string; username: string; fullName: string; role: Role; active: boolean; mustChangePassword: boolean; lastSignInAt: string | null; twoStep: boolean }
interface Kiosk { id: string; label: string; pairedAt: string | null; codeExpiresAt: string | null; retiredAt: string | null }
interface HistoryRow { seq: number; at: string; actor: string; action: string; detail: Record<string, unknown> }

import { TABS, type Tab } from './tabs';

interface Summary {
  people: number; peopleByRole: Partial<Record<Role, number>>; temporaryPasswords: number; deactivated: number;
  kiosks: number; kiosksWaiting: number; sessions: number; onSiteNow: number; visits30Days: number; visitsAllTime: number;
  trucks30Days: number; gateCorrections30Days: number; lastChange: string | null;
}
interface Site { name: string; safetyVisitor: string[]; safetyDriver: string; kioskWelcome: string | null; updatedAt: string; updatedBy: string | null; requireTwoStepAdmins: boolean; keepPhotoDays: number; keepPersonalDays: number }
interface Check { intact: boolean; entries: number; fingerprint: string | null }
interface OpenSession { id: string; who: string; kind: 'person' | 'kiosk'; role: string; startedAt: string; expiresAt: string; isMe: boolean }

export function Admin({ myId, start }: { myId: string; start: Tab }) {
  const [tab, setTabState] = useState<Tab>(start);
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, '', t === 'overview' ? '/admin' : `/admin?tab=${t}`);
  };
  return (
    <div className="space-y-5">
      <div>
        <p className="tag">Admin console</p>
        <h1 className="text-3xl font-black tracking-tight">Run the site</h1>
        <p className="text-sm text-ink-2">People, tablets, wording, sign-ins, the history and your data. Everything here only touches this site.</p>
      </div>
      <div role="tablist" aria-label="Admin sections" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={cx('whitespace-nowrap rounded-md border-2 px-3 py-1.5 text-sm font-extrabold uppercase tracking-wider',
              tab === t.id ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-2 hover:border-rule-strong hover:text-ink')}>
            {t.text}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview go={setTab} />}
      {tab === 'people' && <People myId={myId} />}
      {tab === 'kiosks' && <Kiosks />}
      {tab === 'site' && <SiteSettings />}
      {tab === 'sessions' && <Sessions />}
      {tab === 'history' && <History />}
      {tab === 'export' && <Export />}
    </div>
  );
}

function Overview({ go }: { go: (t: Tab) => void }) {
  const [s, setS] = useState<Summary | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [noTwoStep, setNoTwoStep] = useState(0);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    send<Summary>('GET', '/api/team/summary').then(setS).catch((e) => setProblem((e as Problem).message));
    send<Check>('GET', '/api/team/history/check').then(setCheck).catch(() => undefined);
    send<Account[]>('GET', '/api/team/accounts').then((l) => setNoTwoStep(l.filter((a) => a.active && a.role === 'admin' && !a.twoStep).length)).catch(() => undefined);
  }, []);
  if (problem) return <Notice>{problem}</Notice>;
  if (!s) return <p className="text-ink-2">Loading…</p>;

  const tiles: { label: string; value: number | string; note?: string; tab?: Tab; tone?: string }[] = [
    { label: 'On site now', value: s.onSiteNow, note: 'people and trucks not yet out' },
    { label: 'Visits, last 30 days', value: s.visits30Days, note: `${s.trucks30Days} of them trucks · ${s.visitsAllTime} all time` },
    { label: 'Gate corrections, 30 days', value: s.gateCorrections30Days, note: 'trailer or seal fixed at the gate', tone: s.gateCorrections30Days ? 'text-wait' : undefined },
    { label: 'Active people', value: s.people, note: (Object.entries(s.peopleByRole) as [Role, number][]).map(([r, n]) => `${n} ${ROLE_NAMES[r].toLowerCase()}`).join(' · '), tab: 'people' },
    { label: 'Reception tablets', value: s.kiosks, note: s.kiosksWaiting ? `${s.kiosksWaiting} waiting for a code` : 'all paired', tab: 'kiosks' },
    { label: 'Signed in now', value: s.sessions, note: 'people and tablets', tab: 'sessions' },
  ];
  const todo: { text: string; tab: Tab }[] = [];
  if (s.temporaryPasswords) todo.push({ text: `${s.temporaryPasswords} ${s.temporaryPasswords === 1 ? 'person has' : 'people have'} not chosen their own password yet`, tab: 'people' });
  if (s.kiosksWaiting) todo.push({ text: `${s.kiosksWaiting} tablet${s.kiosksWaiting === 1 ? ' is' : 's are'} waiting to be paired`, tab: 'kiosks' });
  if (noTwoStep) todo.push({ text: `${noTwoStep} admin${noTwoStep === 1 ? ' has' : 's have'} no two-step sign-in`, tab: 'people' });
  if ((s.peopleByRole.admin ?? 0) < 2) todo.push({ text: 'Only one admin: add a second so the site is never locked out', tab: 'people' });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {tiles.map((t) => {
          const body = (
            <>
              <span className="tag block">{t.label}</span>
              <span className={cx('block font-mono text-4xl font-black', t.tone)}>{t.value}</span>
              {t.note && <span className="block text-xs text-ink-2">{t.note}</span>}
            </>
          );
          return t.tab
            ? <button key={t.label} onClick={() => go(t.tab!)} className="rounded-lg border-2 border-rule bg-sheet px-4 py-3 text-left hover:border-ink">{body}</button>
            : <div key={t.label} className="rounded-lg border-2 border-rule bg-sheet px-4 py-3">{body}</div>;
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Sheet className="p-4">
          <p className="text-lg font-extrabold">Needs attention</p>
          {todo.length ? (
            <ul className="mt-2 space-y-2">
              {todo.map((t) => (
                <li key={t.text} className="flex items-center justify-between gap-3 rounded-md border-l-4 border-wait bg-wait-soft px-3 py-2 text-sm">
                  <span className="font-semibold text-wait">{t.text}</span>
                  <Button tone="quiet" onClick={() => go(t.tab)}>Open</Button>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-ink-2">Nothing to do.</p>}
        </Sheet>
        <Sheet className="p-4">
          <p className="text-lg font-extrabold">History</p>
          {check ? (
            <p className={cx('mt-2 text-sm font-semibold', check.intact ? 'text-go' : 'text-stop')}>
              {check.intact ? `Intact: all ${check.entries} entries check out.` : 'Broken: an entry was changed or removed outside the app. Tell your provider.'}
            </p>
          ) : null}
          {check?.fingerprint ? (
            <p className="mt-1 text-xs text-ink-2">Fingerprint at entry {check.entries}: <span className="break-all font-mono">{check.fingerprint.slice(0, 16)}…</span> (History tab to save and compare)</p>
          ) : <p className="mt-2 text-sm text-ink-2">Checking…</p>}
          <p className="mt-1 text-xs text-ink-2">Last change {s.lastChange ? new Date(s.lastChange).toLocaleString() : 'never'}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => go('history')}>Open history</Button>
            <Button tone="quiet" onClick={() => go('export')}>Export data</Button>
          </div>
        </Sheet>
      </div>
    </div>
  );
}

function SiteSettings() {
  const [site, setSite] = useState<Site | null>(null);
  const [name, setName] = useState('');
  const [rules, setRules] = useState('');
  const [driver, setDriver] = useState('');
  const [welcome, setWelcome] = useState('');
  const [twoStep, setTwoStep] = useState(true);
  const [photoDays, setPhotoDays] = useState('30');
  const [personalDays, setPersonalDays] = useState('365');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => send<Site>('GET', '/api/site').then((s) => {
    setSite(s); setName(s.name); setRules(s.safetyVisitor.join('\n')); setDriver(s.safetyDriver); setWelcome(s.kioskWelcome ?? '');
    setTwoStep(s.requireTwoStepAdmins); setPhotoDays(String(s.keepPhotoDays)); setPersonalDays(String(s.keepPersonalDays));
  }).catch((e) => setProblem(e as Problem)), []);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setProblem(null); setSaved('');
    try {
      await send('PATCH', '/api/team/site', {
        name, safetyVisitor: rules.split('\n'), safetyDriver: driver, kioskWelcome: welcome,
        requireTwoStepAdmins: twoStep, keepPhotoDays: Number(photoDays), keepPersonalDays: Number(personalDays),
      });
      setSaved('Saved. Kiosks and the gate show the new wording straight away.');
      load();
    } catch (err) { setProblem(err as Problem); }
    setBusy(false);
  }

  if (!site) return problem ? <Notice>{problem.message}</Notice> : <p className="text-ink-2">Loading…</p>;
  const area = (err?: string) => cx('mt-1 block w-full rounded-md border-2 bg-sheet px-3 py-2.5 text-base', err ? 'border-stop' : 'border-rule focus:border-signal');
  const lines = rules.split('\n').filter((l) => l.trim()).length;

  return (
    <form onSubmit={save} className="grid gap-6 lg:grid-cols-[1fr_340px]" noValidate>
      <div className="space-y-4">
        {problem && <Notice>{problem.message}</Notice>}
        {saved && <Notice tone="go">{saved}</Notice>}
        <Field label="Site name" required value={name} onChange={(e) => setName(e.target.value)} error={problem?.fieldErrors.name} hint="Shown on every screen and on the kiosk." />
        <label className="block">
          <span className="tag">Kiosk safety rules <span className="normal-case tracking-normal">· one per line, {lines} of 12</span></span>
          <textarea rows={7} className={area(problem?.fieldErrors.safetyVisitor)} value={rules} onChange={(e) => setRules(e.target.value)} />
          {problem?.fieldErrors.safetyVisitor && <span className="mt-1 block text-sm font-semibold text-stop">{problem.fieldErrors.safetyVisitor}</span>}
        </label>
        <label className="block">
          <span className="tag">Driver safety note</span>
          <textarea rows={3} className={area(problem?.fieldErrors.safetyDriver)} value={driver} onChange={(e) => setDriver(e.target.value)} />
          <span className="mt-1 block text-sm text-ink-2">Security confirms it was explained when checking a driver in.</span>
        </label>
        <Field label="Kiosk welcome note (optional)" value={welcome} onChange={(e) => setWelcome(e.target.value)} error={problem?.fieldErrors.kioskWelcome}
          hint="A short line under the welcome, e.g. “Deliveries go to door 3.”" />
        <fieldset className="space-y-3 rounded-lg border-2 border-rule p-4">
          <legend className="tag px-1">Security and privacy</legend>
          <Check label="Admins must use two-step sign-in" hint="Recommended. Admins without it are asked to set it up at their next step in the app."
            checked={twoStep} onChange={setTwoStep} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Keep visitor photos (days)" type="number" min={1} max={365} value={photoDays} onChange={(e) => setPhotoDays(e.target.value)}
              error={problem?.fieldErrors.keepPhotoDays} hint="After someone leaves. 1 to 365." />
            <Field label="Keep names and contact details (days)" type="number" min={30} max={3650} value={personalDays} onChange={(e) => setPersonalDays(e.target.value)}
              error={problem?.fieldErrors.keepPersonalDays} hint="After someone leaves. 30 to 3,650. The visit itself (company, truck, seals, times) stays." />
          </div>
          <p className="text-xs text-ink-2">Removal runs every hour and is written to the history.</p>
        </fieldset>
        <Button tone="go" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</Button>
        <p className="text-xs text-ink-2">Last changed {new Date(site.updatedAt).toLocaleString()}{site.updatedBy ? ` by ${site.updatedBy}` : ''}.</p>
      </div>
      <Sheet className="h-fit p-4">
        <p className="tag">Preview · kiosk</p>
        <p className="mt-2 text-lg font-black">Welcome to {name || '…'}</p>
        {welcome && <p className="text-sm text-ink-2">{welcome}</p>}
        <ol className="mt-3 space-y-1.5">
          {rules.split('\n').filter((l) => l.trim()).slice(0, 12).map((l, i) => (
            <li key={i} className="flex gap-2 text-sm"><span className="font-mono font-black text-signal">{i + 1}</span><span>{l}</span></li>
          ))}
        </ol>
      </Sheet>
    </form>
  );
}

function Sessions() {
  const [rows, setRows] = useState<OpenSession[] | null>(null);
  const [problem, setProblem] = useState('');
  const [told, setTold] = useState('');
  const load = useCallback(() => send<OpenSession[]>('GET', '/api/team/sessions').then(setRows).catch((e) => setProblem((e as Problem).message)), []);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<unknown>, msg: string) {
    setProblem(''); setTold('');
    try { await fn(); setTold(msg); load(); } catch (e) { setProblem((e as Problem).message); }
  }

  return (
    <section className="space-y-3">
      <SectionHead title="Signed in now" count={rows?.length}>
        <div className="flex flex-wrap gap-2">
          <Button tone="stop" onClick={() => {
            if (!confirm('Sign out everyone except you? Tablets stay paired.')) return;
            act(async () => { const r = await send<{ ended: number }>('POST', '/api/team/sessions/end-all', { kiosks: false }); setTold(`${r.ended} signed out.`); }, '');
          }}>Sign everyone else out</Button>
          <Button tone="quiet" onClick={() => {
            if (!confirm('Sign out everyone except you AND un-pair every tablet? Each tablet then needs a new code.')) return;
            act(async () => { await send('POST', '/api/team/sessions/end-all', { kiosks: true }); }, 'Everyone signed out and every tablet un-paired.');
          }}>…and tablets too</Button>
        </div>
      </SectionHead>
      <p className="text-sm text-ink-2">Use this if a phone or password may be lost or shared. People sign in again with their own password.</p>
      {problem && <Notice>{problem}</Notice>}
      {told && <Notice tone="go">{told}</Notice>}
      <ul className="divide-y-2 divide-rule rounded-lg border-2 border-rule bg-sheet">
        {(rows ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold">{r.who} {r.isMe && <Stamp kind="in" label="You" />}</p>
              <p className="text-sm text-ink-2">
                {r.kind === 'kiosk' ? 'Reception tablet' : ROLE_NAMES[r.role as Role] ?? r.role} · since {new Date(r.startedAt).toLocaleString()} · ends {new Date(r.expiresAt).toLocaleString()}
              </p>
            </div>
            {!r.isMe && <Button onClick={() => act(() => send('POST', `/api/team/sessions/${r.id}/end`), `${r.who} signed out.`)}>Sign out</Button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Export() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  async function download() {
    setBusy(true); setProblem('');
    try {
      const data = await send('POST', '/api/team/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `gatehouse-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setProblem((e as Problem).message); }
    setBusy(false);
  }
  return (
    <Sheet className="max-w-2xl space-y-3 p-5">
      <p className="text-lg font-extrabold">Everything this site holds, in one file</p>
      <p className="text-sm text-ink-2">
        Every visit (without photos), the people and tablets, the site wording, the full history and today&apos;s history
        fingerprint. Use it for your own
        records, an audit, or to take your data with you. It contains names and phone numbers: keep it somewhere safe.
      </p>
      {problem && <Notice>{problem}</Notice>}
      <Button tone="go" disabled={busy} onClick={download}>{busy ? 'Preparing…' : 'Download export (JSON)'}</Button>
      <p className="text-xs text-ink-2">Each export is recorded in the history. For one day as a spreadsheet, use Download CSV on the Log page (also recorded).</p>
    </Sheet>
  );
}

function newTempPassword() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('') + '7a';
}

function People({ myId }: { myId: string }) {
  const [list, setList] = useState<Account[] | null>(null);
  const [problem, setProblem] = useState('');
  const [told, setTold] = useState('');
  const load = useCallback(() => send<Account[]>('GET', '/api/team/accounts').then(setList).catch((e) => setProblem((e as Problem).message)), []);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<unknown>, msg: string) {
    setProblem(''); setTold('');
    try { await fn(); setTold(msg); load(); } catch (e) { setProblem((e as Problem).message); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="space-y-3">
        <SectionHead title="People" count={list?.filter((a) => a.active).length} />
        {problem && <Notice>{problem}</Notice>}
        {told && <Notice tone="go">{told}</Notice>}
        {list && !list.length && <Empty>No accounts yet.</Empty>}
        <ul className="space-y-2">
          {(list ?? []).map((a) => {
            const me = a.id === myId;
            return (
              <li key={a.id} className={cx('rounded-lg border-2 bg-sheet p-3', a.active ? 'border-rule' : 'border-dashed border-rule opacity-70')}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{a.fullName}</span>
                  <span className="font-mono text-sm text-ink-2">{a.username}</span>
                  {!a.active && <Stamp kind="out" label="Deactivated" />}
                  {a.active && a.mustChangePassword && <Stamp kind="cleared" label="Temporary password" />}
                  {a.active && (a.twoStep ? <Stamp kind="in" label="Two-step on" /> : a.role === 'admin' ? <Stamp kind="cleared" label="No two-step" /> : null)}
                  <span className="ml-auto text-xs text-ink-2">{a.lastSignInAt ? `last in ${new Date(a.lastSignInAt).toLocaleString()}` : 'never signed in'}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="text-sm"><span className="sr-only">Role for {a.fullName}</span>
                    <select className="rounded-md border-2 border-rule bg-sheet px-2 py-1.5 text-sm font-semibold" value={a.role} disabled={me || !a.active}
                      onChange={(e) => act(() => send('PATCH', `/api/team/accounts/${a.id}`, { role: e.target.value }), `${a.fullName} is now ${ROLE_NAMES[e.target.value as Role]}. Their open sessions were ended.`)}>
                      {(Object.keys(ROLE_NAMES) as Role[]).map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
                    </select>
                  </label>
                  {!me && (
                    <Button tone={a.active ? 'stop' : 'plain'} onClick={() => {
                      if (a.active && !confirm(`Deactivate ${a.fullName}? They are signed out at once.`)) return;
                      act(() => send('PATCH', `/api/team/accounts/${a.id}`, { active: !a.active }), a.active ? `${a.fullName} deactivated.` : `${a.fullName} can sign in again.`);
                    }}>{a.active ? 'Deactivate' : 'Reactivate'}</Button>
                  )}
                  {a.active && !me && (
                    <Button tone="quiet" onClick={() => {
                      const pw = newTempPassword();
                      act(() => send('POST', `/api/team/accounts/${a.id}/reset-password`, { password: pw }),
                        `Temporary password for ${a.username}: ${pw}  (give it to them in person; they choose their own at sign-in)`);
                    }}>Reset password</Button>
                  )}
                  {a.active && !me && a.twoStep && (
                    <Button tone="quiet" onClick={() => {
                      if (!confirm(`Reset two-step sign-in for ${a.fullName}? Use this when they lost their phone. They are signed out and set it up again.`)) return;
                      act(() => send('POST', `/api/team/accounts/${a.id}/reset-two-step`), `Two-step sign-in reset for ${a.fullName}.`);
                    }}>Reset two-step</Button>
                  )}
                  {me && <span className="text-xs text-ink-2">This is you. Another admin can change your role or reset your two-step sign-in.</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <AddPerson onAdded={load} />
    </div>
  );
}

function AddPerson({ onAdded }: { onAdded: () => void }) {
  const [f, setF] = useState({ fullName: '', username: '', role: 'security' as Role });
  const [problem, setProblem] = useState<Problem | null>(null);
  const [made, setMade] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setProblem(null); setMade('');
    const password = newTempPassword();
    try {
      await send('POST', '/api/team/accounts', { ...f, password });
      setMade(`${f.username.toLowerCase()} added. Temporary password: ${password}`);
      setF({ fullName: '', username: '', role: f.role });
      onAdded();
    } catch (err) { setProblem(err as Problem); }
    setBusy(false);
  }

  return (
    <Sheet className="h-fit p-4">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <p className="text-lg font-extrabold">Add a person</p>
        {problem && <Notice>{problem.message}</Notice>}
        {made && <Notice tone="go"><span className="break-all font-mono">{made}</span><br /><span className="font-normal">Give it to them in person. They pick their own at first sign-in.</span></Notice>}
        <Field label="Full name" required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} error={problem?.fieldErrors.fullName} />
        <Field label="Username" required autoCapitalize="none" hint="3-40 characters: letters, numbers, dot, dash" value={f.username}
          onChange={(e) => setF({ ...f, username: e.target.value })} error={problem?.fieldErrors.username} />
        <label className="block"><span className="tag">Role</span>
          <select className="mt-1 block w-full rounded-md border-2 border-rule bg-sheet px-3 py-2.5" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {(Object.keys(ROLE_NAMES) as Role[]).map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
          </select></label>
        <Button tone="go" className="w-full" disabled={busy}>Add person</Button>
      </form>
    </Sheet>
  );
}

function Kiosks() {
  const [list, setList] = useState<Kiosk[] | null>(null);
  const [label, setLabel] = useState('');
  const [code, setCode] = useState<{ label: string; code: string } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const load = useCallback(() => send<Kiosk[]>('GET', '/api/team/kiosks').then(setList).catch((e) => setProblem(e as Problem)), []);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setProblem(null);
    try {
      const r = await send<{ code: string }>('POST', '/api/team/kiosks', { label });
      setCode({ label, code: r.code }); setLabel(''); load();
    } catch (err) { setProblem(err as Problem); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="space-y-3">
        <SectionHead title="Reception tablets" count={list?.filter((k) => !k.retiredAt).length} />
        {code && (
          <div className="rounded-lg border-2 border-signal bg-signal-soft p-4">
            <p className="font-bold">Pairing code for {code.label}</p>
            <p className="my-2 font-mono text-3xl font-black tracking-[0.2em] break-all">{code.code.slice(0, 5)}-{code.code.slice(5)}</p>
            <p className="text-sm">On the tablet, open this site&apos;s <span className="font-mono">/kiosk</span> page and type the code. It works once, within 30 minutes.</p>
          </div>
        )}
        {problem && <Notice>{problem.message}</Notice>}
        {list && !list.length && <Empty>No kiosks yet. Add one for each reception tablet.</Empty>}
        <ul className="space-y-2">
          {(list ?? []).map((k) => (
            <li key={k.id} className={cx('flex flex-wrap items-center gap-2 rounded-lg border-2 bg-sheet p-3', k.retiredAt ? 'border-dashed border-rule opacity-60' : 'border-rule')}>
              <span className="font-bold">{k.label}</span>
              {k.retiredAt ? <Stamp kind="out" label="Retired" /> : k.pairedAt ? <Stamp kind="in" label="Paired" /> : <Stamp kind="cleared" label="Waiting for code" />}
              {!k.retiredAt && (
                <span className="ml-auto flex gap-2">
                  <Button tone="quiet" onClick={async () => {
                    if (k.pairedAt && !confirm(`A new code un-pairs the tablet now in use at ${k.label}. Go on?`)) return;
                    try { const r = await send<{ code: string }>('POST', `/api/team/kiosks/${k.id}/new-code`); setCode({ label: k.label, code: r.code }); load(); } catch (e) { setProblem(e as Problem); }
                  }}>New code</Button>
                  <Button tone="stop" onClick={async () => {
                    if (!confirm(`Retire ${k.label}? The tablet stops working at once.`)) return;
                    try { await send('POST', `/api/team/kiosks/${k.id}/retire`); load(); } catch (e) { setProblem(e as Problem); }
                  }}>Retire</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      <Sheet className="h-fit p-4">
        <form onSubmit={add} className="space-y-3" noValidate>
          <p className="text-lg font-extrabold">Add a kiosk</p>
          <Field label="Where is it?" required placeholder="Front lobby" value={label} onChange={(e) => setLabel(e.target.value)} error={problem?.fieldErrors.label} />
          <Button tone="go" className="w-full">Add and get a code</Button>
        </form>
      </Sheet>
    </div>
  );
}

function History() {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [problem, setProblem] = useState('');
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState({ entries: '', fingerprint: '' });
  const [result, setResult] = useState<{ matches: boolean; reason: string } | null>(null);
  const [cmpProblem, setCmpProblem] = useState<Problem | null>(null);
  useEffect(() => { send<HistoryRow[]>('GET', '/api/team/history').then(setRows).catch((e) => setProblem((e as Problem).message)); }, []);
  async function runCheck() {
    setChecking(true);
    try { setCheck(await send('GET', '/api/team/history/check')); } catch (e) { setProblem((e as Problem).message); }
    setChecking(false);
  }
  return (
    <section className="space-y-3">
      <SectionHead title="History"><Button onClick={runCheck} disabled={checking}>{checking ? 'Checking…' : 'Check for tampering'}</Button></SectionHead>
      {check && (check.intact
        ? <Notice tone="go">Intact: all {check.entries} entries check out against their chain.</Notice>
        : <Notice>Broken: an entry was changed or removed outside the app. Tell your provider straight away.</Notice>)}
      {check?.fingerprint && (
        <Sheet className="space-y-2 p-4">
          <p className="font-extrabold">Today&apos;s fingerprint</p>
          <p className="text-sm text-ink-2">
            Keep a copy outside this server (email it to yourself or print it). Comparing later proves nobody, not even
            someone with access to the server, rewrote or removed entries up to this point.
          </p>
          <p className="text-sm">Entries: <span className="font-mono font-bold">{check.entries}</span></p>
          <p className="break-all rounded-md border-2 border-ink bg-plate px-3 py-2 font-mono text-sm font-bold">{check.fingerprint}</p>
          <Button tone="quiet" onClick={() => navigator.clipboard?.writeText(`Gatehouse history fingerprint: entries ${check.entries}, ${check.fingerprint}`)}>Copy</Button>
        </Sheet>
      )}
      <Sheet className="p-4">
        <form className="space-y-3" noValidate onSubmit={async (e) => {
          e.preventDefault(); setCmpProblem(null); setResult(null);
          try { setResult(await send('POST', '/api/team/history/compare', { entries: Number(saved.entries), fingerprint: saved.fingerprint })); }
          catch (err) { setCmpProblem(err as Problem); }
        }}>
          <p className="font-extrabold">Compare with a saved fingerprint</p>
          {cmpProblem && <Notice>{cmpProblem.message}</Notice>}
          {result && <Notice tone={result.matches ? 'go' : 'stop'}>{result.reason}</Notice>}
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <Field label="Entries" inputMode="numeric" value={saved.entries} onChange={(e) => setSaved({ ...saved, entries: e.target.value })} error={cmpProblem?.fieldErrors.entries} />
            <Field label="Fingerprint" mono value={saved.fingerprint} onChange={(e) => setSaved({ ...saved, fingerprint: e.target.value.trim() })} error={cmpProblem?.fieldErrors.fingerprint} />
          </div>
          <Button>Compare</Button>
        </form>
      </Sheet>
      <p className="text-sm text-ink-2">The latest 300 changes, newest first (the export has all of them). Entries cannot be edited or removed, and each one is chained to the one before it.</p>
      {problem && <Notice>{problem}</Notice>}
      <ol className="divide-y divide-rule rounded-lg border-2 border-rule bg-sheet">
        {(rows ?? []).map((h) => (
          <li key={h.seq} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-sm">
            <span className="w-40 shrink-0 font-mono text-ink-2">{new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="font-bold">{h.actor}</span>
            <span>{h.action}</span>
            <span className="min-w-0 truncate text-ink-2">{Object.entries(h.detail ?? {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>
          </li>
        ))}
      </ol>
      {rows && !rows.length && <Empty>Nothing yet.</Empty>}
    </section>
  );
}
