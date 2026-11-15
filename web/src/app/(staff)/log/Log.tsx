'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Notice, Plate, Stamp, cx } from '@/components/kit';
import { Problem, send } from '@/lib/client';
import { clock, stampFor, type Role, type Visit } from '@/lib/types';

function daysAgo(n: number) {
  const d = new Date(Date.now() - n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const yn = (b: boolean | null) => (b === null ? '' : b ? 'Yes' : 'No');

/** Every column, for the CSV. */
const CSV: [string, (v: Visit) => string][] = [
  ['Status', (v) => v.status], ['Type', (v) => v.kind], ['Name', (v) => v.fullName], ['Company', (v) => v.companyName ?? ''],
  ['Phone', (v) => v.phone], ['Email', (v) => v.email ?? ''], ['Visiting', (v) => v.hostName ?? ''], ['Purpose', (v) => v.purpose],
  ['Insurance No.', (v) => v.insuranceNumber ?? ''], ['ID scanned', (v) => yn(v.idScanned)],
  ['Plate', (v) => v.truckLicensePlate ?? ''], ['Truck No.', (v) => v.truckNumber ?? ''], ['Appointment No.', (v) => v.appointmentNumber ?? ''],
  ['SCAC', (v) => v.scacCode ?? ''], ['Vehicle', (v) => v.vehicleType ?? ''], ["Driver's licence", (v) => v.driverLicense ?? ''],
  ['Visit reason', (v) => v.visitReason ?? ''], ['Bobtail', (v) => yn(v.bobtail)], ['Trailer IN', (v) => v.trailerNoIn ?? ''],
  ['Arrived empty', (v) => yn(v.arrivedEmpty)], ['Seal IN', (v) => v.sealNoIn ?? ''], ['Going empty', (v) => yn(v.goingEmpty)],
  ['Trailer OUT', (v) => v.trailerNoOut ?? ''], ['Seal OUT', (v) => v.sealNoOut ?? ''],
  ['Arrived', (v) => v.arrivedAt], ['Checked in by', (v) => v.arrivedVia], ['Dock cleared', (v) => v.dockClearedAt ?? ''],
  ['Dock cleared by', (v) => v.dockClearedBy ?? ''], ['Left', (v) => v.leftAt ?? ''], ['Released by', (v) => v.releasedBy ?? ''],
];

function csvCell(s: string) {
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // a spreadsheet must never run a cell as a formula
  return `"${safe.replace(/"/g, '""')}"`;
}

export function Log({ role }: { role: Role }) {
  const [date, setDate] = useState(today());
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState(role === 'dock' ? 'driver' : '');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Visit[] | null>(null);
  const [problem, setProblem] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ date, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (status) p.set('status', status);
    if (kind) p.set('kind', kind);
    if (q.trim()) p.set('q', q.trim());
    try { setRows(await send<Visit[]>('GET', `/api/visits?${p}`)); setProblem(''); }
    catch (e) { setProblem((e as Problem).message); }
  }, [date, status, kind, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const csv = useMemo(() => {
    if (!rows?.length) return '';
    return [CSV.map(([h]) => csvCell(h)).join(','), ...rows.map((r) => CSV.map(([, f]) => csvCell(f(r))).join(','))].join('\r\n');
  }, [rows]);

  async function download() {
    try { await send('POST', '/api/visits/downloaded', { day: date, rows: rows?.length ?? 0 }); }
    catch (e) { setProblem((e as Problem).message); return; }
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `gatehouse-log-${date}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const control = 'mt-1 block w-full rounded-md border-2 border-rule bg-sheet px-3 py-2 text-base text-ink focus:border-signal';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="tag">Log</p>
          <h1 className="text-3xl font-black tracking-tight">Everyone through the gate</h1>
          <p className="text-sm text-ink-2">The chosen day, plus anyone still on site from before.</p>
        </div>
        <Button onClick={download} disabled={!csv}>Download CSV</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="col-span-2 md:col-span-1"><span className="tag">Search</span>
          <input className={control} placeholder="Name, plate, trailer, appt…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label><span className="tag">Day</span><input type="date" className={control} value={date} max={today()} min={role === 'admin' ? undefined : daysAgo(31)} onChange={(e) => setDate(e.target.value || today())} /></label>
        <label><span className="tag">Status</span>
          <select className={control} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option><option value="on_site">On site / at dock</option><option value="dock_cleared">Cleared · to gate</option><option value="left">Left</option>
          </select></label>
        {role !== 'dock' && (
          <label><span className="tag">Type</span>
            <select className={control} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Everyone</option><option value="driver">Drivers</option><option value="visitor">Visitors</option><option value="contractor">Contractors</option>
            </select></label>
        )}
      </div>

      {problem && <Notice>{problem}</Notice>}

      {rows && !rows.length ? <Empty>Nothing for this day and these filters.</Empty> : (
        <div className="overflow-x-auto rounded-lg border-2 border-rule bg-sheet">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-sheet-2 text-left">
              <tr className="border-b-2 border-ink">
                {['Status', 'Who', 'Company', 'Plate', 'Trailer in → out', 'Seal in → out', 'In', 'Dock', 'Out'].map((h) => (
                  <th key={h} scope="col" className="tag whitespace-nowrap px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((v) => (
                <Row key={v.id} v={v} admin={role === 'admin'} onChanged={load} open={open === v.id} onToggle={() => setOpen(open === v.id ? null : v.id)} />
              ))}
            </tbody>
          </table>
          {!rows && <p className="p-4 text-sm text-ink-2">Loading…</p>}
          {rows && rows.length >= 2000 && <p className="p-3 text-sm text-wait">Showing the first 2,000. Narrow the search to see the rest.</p>}
        </div>
      )}
    </div>
  );
}

function Row({ v, open, onToggle, admin, onChanged }: { v: Visit; open: boolean; onToggle: () => void; admin: boolean; onChanged: () => void }) {
  const truck = v.kind === 'driver';
  return (
    <>
      <tr className={cx('cursor-pointer border-b border-rule align-top hover:bg-sheet-2', open && 'bg-sheet-2')} onClick={onToggle}>
        <td className="px-3 py-2"><Stamp kind={stampFor(v)} /></td>
        <td className="px-3 py-2">
          <button type="button" aria-expanded={open} className="text-left font-bold underline-offset-2 hover:underline">{v.fullName}</button>
          <span className="block text-xs text-ink-2">{v.kind}{v.hostName ? ` · visiting ${v.hostName}` : ''}</span>
        </td>
        <td className="px-3 py-2">{v.companyName ?? '—'}</td>
        <td className="px-3 py-2">{truck ? <Plate>{v.truckLicensePlate}</Plate> : '—'}</td>
        <td className="whitespace-nowrap px-3 py-2">{truck ? <>{v.bobtail ? 'Bobtail' : <Plate dim>{v.trailerNoIn}</Plate>} → {v.goingEmpty ? 'Empty' : <Plate dim>{v.trailerNoOut}</Plate>}</> : '—'}</td>
        <td className="whitespace-nowrap px-3 py-2">{truck ? <>{v.arrivedEmpty ? 'Empty' : v.bobtail ? '—' : <Plate dim>{v.sealNoIn}</Plate>} → {v.goingEmpty ? 'Empty' : <Plate dim>{v.sealNoOut}</Plate>}</> : '—'}</td>
        <td className="whitespace-nowrap px-3 py-2 font-mono">{clock(v.arrivedAt)}</td>
        <td className="whitespace-nowrap px-3 py-2 font-mono">{clock(v.dockClearedAt) || '—'}</td>
        <td className="whitespace-nowrap px-3 py-2 font-mono">{clock(v.leftAt) || '—'}</td>
      </tr>
      {open && <tr className="border-b-2 border-rule bg-sheet-2"><td colSpan={9} className="px-3 py-4"><Detail id={v.id} admin={admin} onChanged={onChanged} /></td></tr>}
    </>
  );
}

function Detail({ id, admin, onChanged }: { id: string; admin: boolean; onChanged: () => void }) {
  const [v, setV] = useState<Visit | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => { send<Visit>('GET', `/api/visits/${id}`).then(setV).catch((e) => setProblem((e as Problem).message)); }, [id]);
  if (problem) return <Notice>{problem}</Notice>;
  if (!v) return <p className="text-sm text-ink-2">Loading…</p>;
  const items: [string, React.ReactNode][] = [
    ['Phone', v.phone], ['Email', v.email], ['Purpose', v.purpose], ['Visiting', v.hostName], ['Insurance No.', v.insuranceNumber],
    ['ID scanned', v.kind === 'driver' ? null : yn(v.idScanned)], ["Driver's licence", v.driverLicense], ['SCAC', v.scacCode],
    ['Vehicle', v.vehicleType], ['Visit reason', v.visitReason], ['Truck No.', v.truckNumber], ['Appointment No.', v.appointmentNumber],
    ['Arrived', `${new Date(v.arrivedAt).toLocaleString()} · ${v.arrivedVia}`],
    ['Cleared at dock', v.dockClearedAt ? `${new Date(v.dockClearedAt).toLocaleString()} · ${v.dockClearedBy}` : null],
    ['Left', v.leftAt ? `${new Date(v.leftAt).toLocaleString()} · released by ${v.releasedBy}` : null],
  ];
  const erasable = admin && v.fullName !== 'Removed' && (v.status === 'left' || Date.now() - new Date(v.arrivedAt).getTime() > 86_400_000);
  return (
    <div className="space-y-3">
    <div className="flex flex-col gap-4 sm:flex-row">
      {v.photoData && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.photoData} alt={`Photo of ${v.fullName}`} className="h-36 w-36 shrink-0 rounded-md border-2 border-rule object-cover" />
      )}
      <dl className="grid flex-1 grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.filter(([, val]) => val !== null && val !== undefined && val !== '').map(([k, val]) => (
          <div key={k}><dt className="tag">{k}</dt><dd className="mt-0.5 break-words">{val}</dd></div>
        ))}
      </dl>
    </div>
    {erasable && (
      <Button tone="stop" onClick={async () => {
        if (!confirm(`Erase ${v.fullName}'s personal details? Name, phone, email, ID numbers and photo are removed for good. The visit itself stays.`)) return;
        try { await send('POST', `/api/team/visits/${v.id}/erase`); onChanged(); } catch (e) { setProblem((e as Problem).message); }
      }}>Erase personal details (on request)</Button>
    )}
    </div>
  );
}
