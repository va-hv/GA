'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Field, Notice, Pick, Plate, SectionHead, Stamp, cx } from '@/components/kit';
import { Person, Hardhat, Truck } from '@/components/glyphs';
import { Problem, send } from '@/lib/client';
import { clock, since, stampFor, type Role, type Visit } from '@/lib/types';

const REFRESH_MS = 15_000;

export function Yard({ role }: { role: Role }) {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [loadProblem, setLoadProblem] = useState('');
  const [stamp, setStamp] = useState('');

  const load = useCallback(async () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setVisits(await send<Visit[]>('GET', `/api/visits?tz=${encodeURIComponent(tz)}`));
      setLoadProblem('');
      setStamp(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (e) {
      setLoadProblem((e as Problem).message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const all = visits ?? [];
  const atDock = all.filter((v) => v.kind === 'driver' && v.status === 'on_site');
  const cleared = all.filter((v) => v.status === 'dock_cleared');
  const people = all.filter((v) => v.kind !== 'driver' && v.status === 'on_site');
  const leftToday = all.filter((v) => v.status === 'left');

  const counts = [
    { label: 'Trucks at the dock', n: atDock.length, tone: 'text-info' },
    { label: 'Cleared · to gate', n: cleared.length, tone: 'text-wait' },
    ...(role === 'dock' ? [] : [{ label: 'People on site', n: people.length, tone: 'text-info' }]),
    { label: 'Left today', n: leftToday.length, tone: 'text-ink-2' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="tag">{role === 'dock' ? 'Dock' : 'Yard'} · today</p>
          <h1 className="text-3xl font-black tracking-tight">{role === 'dock' ? 'Trucks to clear' : role === 'security' ? 'At the gate' : 'Site overview'}</h1>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-2">
          <span aria-live="polite">{stamp ? `Updated ${stamp}` : 'Loading…'}</span>
          <Button onClick={load}>Refresh</Button>
          {role === 'security' && <Link href="/arrive" className="inline-flex min-h-10 items-center rounded-md border-2 border-signal bg-signal px-4 text-sm font-bold text-signal-ink hover:brightness-110">+ Check in driver</Link>}
        </div>
      </div>

      {loadProblem && <Notice>{loadProblem}</Notice>}

      <dl className={cx('grid gap-3', counts.length === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3')}>
        {counts.map((c) => (
          <div key={c.label} className="rounded-lg border-2 border-rule bg-sheet px-4 py-3">
            <dt className="tag">{c.label}</dt>
            <dd className={cx('font-mono text-4xl font-black', c.tone)}>{visits ? c.n : '–'}</dd>
          </div>
        ))}
      </dl>

      {role === 'security' && (
        <>
          <section className="space-y-3">
            <SectionHead title="Cleared by the dock · check and release" count={cleared.length} />
            {cleared.length ? <Grid>{cleared.map((v) => <TruckPass key={v.id} v={v} action={<ReleaseTruck v={v} onDone={load} />} />)}</Grid>
              : <Empty>No trucks waiting at the gate. The dock clears them first.</Empty>}
          </section>
          <section className="space-y-3">
            <SectionHead title="Visitors and contractors on site" count={people.length} />
            {people.length ? <PeopleList people={people} canCheckOut onDone={load} />
              : <Empty>Nobody signed in at the kiosk is on site.</Empty>}
          </section>
          <section className="space-y-3">
            <SectionHead title="Trucks at the dock" count={atDock.length} />
            {atDock.length ? <Grid>{atDock.map((v) => <TruckPass key={v.id} v={v} action={<p className="text-sm text-ink-2">Waiting for the dock to clear it.</p>} />)}</Grid>
              : <Empty>No trucks at the dock.</Empty>}
          </section>
        </>
      )}

      {role === 'dock' && (
        <>
          <section className="space-y-3">
            <SectionHead title="At the dock · clear when done" count={atDock.length} />
            {atDock.length ? <Grid>{atDock.map((v) => <TruckPass key={v.id} v={v} action={<ClearTruck v={v} onDone={load} />} />)}</Grid>
              : <Empty>No trucks at the dock right now.</Empty>}
          </section>
          <section className="space-y-3">
            <SectionHead title="Cleared · waiting for the gate" count={cleared.length} />
            {cleared.length ? <Grid>{cleared.map((v) => <TruckPass key={v.id} v={v} action={<Withdraw v={v} onDone={load} />} />)}</Grid>
              : <Empty>Nothing waiting at the gate.</Empty>}
          </section>
        </>
      )}

      {role === 'admin' && (
        <>
          <section className="space-y-3">
            <SectionHead title="Trucks on site" count={atDock.length + cleared.length} />
            {atDock.length + cleared.length ? <Grid>{[...cleared, ...atDock].map((v) => <TruckPass key={v.id} v={v} />)}</Grid>
              : <Empty>No trucks on site.</Empty>}
          </section>
          <section className="space-y-3">
            <SectionHead title="Visitors and contractors on site" count={people.length} />
            {people.length ? <PeopleList people={people} /> : <Empty>Nobody from the kiosk is on site.</Empty>}
          </section>
        </>
      )}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

/** One truck, drawn as a gate pass: who, what came in, and (once cleared) what goes out. */
function TruckPass({ v, action }: { v: Visit; action?: React.ReactNode }) {
  return (
    <article className={cx('rounded-lg border-2 bg-sheet', v.status === 'dock_cleared' ? 'border-wait' : 'border-rule')}>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Stamp kind={stampFor(v)} />
            <span className="text-xs font-semibold text-ink-2">{v.purpose} · {v.visitReason}</span>
          </div>
          <h3 className="mt-2 flex items-center gap-2 text-lg font-extrabold"><Truck className="shrink-0 text-ink-2" /> <span className="truncate">{v.companyName}</span></h3>
          <p className="truncate text-sm text-ink-2">{v.fullName} · {v.phone}</p>
        </div>
        <div className="shrink-0 text-right">
          <Plate>{v.truckLicensePlate}</Plate>
          <p className="mt-1 text-xs text-ink-2">in {clock(v.arrivedAt)} · {since(v.arrivedAt)}</p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 px-4 pb-3 text-xs">
        <Cell label="Trailer in">{v.bobtail ? <span className="font-semibold">Bobtail</span> : <Plate dim>{v.trailerNoIn}</Plate>}</Cell>
        <Cell label="Seal in">{v.bobtail ? '—' : v.arrivedEmpty ? <span className="font-semibold">Empty</span> : <Plate dim>{v.sealNoIn}</Plate>}</Cell>
        <Cell label="Truck · appt">{v.truckNumber} · {v.appointmentNumber}</Cell>
      </dl>
      {v.status === 'dock_cleared' && (
        <dl className="tear grid grid-cols-3 gap-2 px-4 py-3 text-xs">
          <Cell label="Going out">{v.goingEmpty ? <span className="font-bold">Empty</span> : <span className="font-bold">Loaded</span>}</Cell>
          <Cell label="Trailer out">{v.goingEmpty ? '—' : <Plate>{v.trailerNoOut}</Plate>}</Cell>
          <Cell label="Seal out">{v.goingEmpty ? '—' : <Plate>{v.sealNoOut}</Plate>}</Cell>
          <p className="col-span-3 text-ink-2">Cleared by {v.dockClearedBy} at {clock(v.dockClearedAt)}</p>
        </dl>
      )}
      {action && <div className="tear p-4">{action}</div>}
    </article>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="tag !text-[0.62rem]">{label}</dt><dd className="mt-1 truncate">{children}</dd></div>;
}

/** Dock coordinator: going empty, or trailer and seal OUT. */
function ClearTruck({ v, onDone }: { v: Visit; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'empty' | 'loaded' | ''>('');
  const [trailer, setTrailer] = useState(v.trailerNoIn ?? '');
  const [seal, setSeal] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  if (!open) return <Button tone="go" className="w-full" onClick={() => setOpen(true)}>Clear this truck</Button>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!mode) { setProblem(new Problem('Choose empty or loaded', 400, { goingEmpty: 'Choose empty or loaded' })); return; }
    setBusy(true); setProblem(null);
    try {
      await send('POST', `/api/visits/${v.id}/dock-clear`, mode === 'empty' ? { goingEmpty: true } : { goingEmpty: false, trailerNoOut: trailer, sealNoOut: seal });
      onDone();
    } catch (err) { setProblem(err as Problem); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {problem && <Notice>{problem.message}</Notice>}
      <Pick label="Leaving" value={mode} onChange={setMode} error={problem?.fieldErrors.goingEmpty}
        options={[{ value: 'empty', text: 'Empty' }, { value: 'loaded', text: 'Loaded' }]} />
      {mode === 'loaded' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Trailer OUT" mono required value={trailer} onChange={(e) => setTrailer(e.target.value)} error={problem?.fieldErrors.trailerNoOut} />
          <Field label="Seal OUT" mono required value={seal} onChange={(e) => setSeal(e.target.value)} error={problem?.fieldErrors.sealNoOut} autoFocus />
        </div>
      )}
      <div className="flex gap-2">
        <Button tone="go" className="flex-1" disabled={busy}>{busy ? 'Saving…' : 'Cleared · send to gate'}</Button>
        <Button type="button" tone="quiet" onClick={() => { setOpen(false); setProblem(null); }}>Cancel</Button>
      </div>
    </form>
  );
}

function Withdraw({ v, onDone }: { v: Visit; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  return (
    <div className="space-y-2">
      {problem && <Notice>{problem}</Notice>}
      <Button tone="stop" className="w-full" disabled={busy} onClick={async () => {
        if (!confirm(`Withdraw the clearance for ${v.truckLicensePlate}? The gate will not be able to release it.`)) return;
        setBusy(true);
        try { await send('POST', `/api/visits/${v.id}/dock-reopen`); onDone(); } catch (e) { setProblem((e as Problem).message); setBusy(false); }
      }}>Withdraw clearance</Button>
    </div>
  );
}

/** Security: compare the truck with what the dock wrote; release as written, or correct first. */
function ReleaseTruck({ v, onDone }: { v: Visit; onDone: () => void }) {
  const [correcting, setCorrecting] = useState(false);
  const [mode, setMode] = useState<'empty' | 'loaded'>(v.goingEmpty ? 'empty' : 'loaded');
  const [trailer, setTrailer] = useState(v.trailerNoOut ?? '');
  const [seal, setSeal] = useState(v.sealNoOut ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function release(body: object) {
    setBusy(true); setProblem(null);
    try { await send('POST', `/api/visits/${v.id}/release`, body); onDone(); }
    catch (err) { setProblem(err as Problem); setBusy(false); }
  }

  if (!correcting) {
    return (
      <div className="space-y-2">
        {problem && <Notice>{problem.message}</Notice>}
        <div className="flex gap-2">
          <Button tone="go" className="flex-1" disabled={busy} onClick={() => release({})}>{busy ? 'Releasing…' : 'Matches · release'}</Button>
          <Button type="button" onClick={() => setCorrecting(true)}>Correct</Button>
        </div>
      </div>
    );
  }
  return (
    <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); release(mode === 'empty' ? { goingEmpty: true } : { goingEmpty: false, trailerNoOut: trailer, sealNoOut: seal }); }}>
      {problem && <Notice>{problem.message}</Notice>}
      <Pick label="Actually leaving" value={mode} onChange={setMode} options={[{ value: 'empty', text: 'Empty' }, { value: 'loaded', text: 'Loaded' }]} />
      {mode === 'loaded' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Trailer OUT" mono value={trailer} onChange={(e) => setTrailer(e.target.value)} error={problem?.fieldErrors.trailerNoOut} />
          <Field label="Seal OUT" mono value={seal} onChange={(e) => setSeal(e.target.value)} error={problem?.fieldErrors.sealNoOut} />
        </div>
      )}
      <div className="flex gap-2">
        <Button tone="go" className="flex-1" disabled={busy}>Release with these</Button>
        <Button type="button" tone="quiet" onClick={() => setCorrecting(false)}>Cancel</Button>
      </div>
    </form>
  );
}

function PeopleList({ people, canCheckOut, onDone }: { people: Visit[]; canCheckOut?: boolean; onDone?: () => void }) {
  return (
    <ul className="divide-y-2 divide-rule overflow-hidden rounded-lg border-2 border-rule bg-sheet">
      {people.map((p) => <PersonRow key={p.id} p={p} canCheckOut={canCheckOut} onDone={onDone} />)}
    </ul>
  );
}

function PersonRow({ p, canCheckOut, onDone }: { p: Visit; canCheckOut?: boolean; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const Icon = p.kind === 'contractor' ? Hardhat : Person;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Icon className="shrink-0 text-ink-2" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">{p.fullName} <Stamp kind={p.kind} /></p>
        <p className="truncate text-sm text-ink-2">
          {p.kind === 'contractor' ? `${p.companyName} · ` : ''}visiting {p.hostName} · {p.purpose}
        </p>
        {problem && <p className="text-sm font-semibold text-stop">{problem}</p>}
      </div>
      <span className="text-sm text-ink-2">in {clock(p.arrivedAt)} · {since(p.arrivedAt)}</span>
      {canCheckOut && (
        <Button disabled={busy} onClick={async () => {
          setBusy(true);
          try { await send('POST', `/api/visits/${p.id}/release`, {}); onDone?.(); } catch (e) { setProblem((e as Problem).message); setBusy(false); }
        }}>{busy ? '…' : 'Check out'}</Button>
      )}
    </li>
  );
}
