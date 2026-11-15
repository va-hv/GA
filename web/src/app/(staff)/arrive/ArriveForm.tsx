'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Check, Choice, Field, Notice, Pick, Sheet } from '@/components/kit';
import { Problem, send } from '@/lib/client';
import { VEHICLE_TYPES, VISIT_REASONS } from '@/lib/types';

const EMPTY = {
  fullName: '', phone: '', driverLicense: '', companyName: '', scacCode: '', vehicleType: '', truckLicensePlate: '',
  truckNumber: '', appointmentNumber: '', visitReason: '', purpose: '' as '' | 'Live' | 'Drop',
  bobtail: false, trailerNoIn: '', arrivedEmpty: false, sealNoIn: '', safetyAccepted: false,
};
type Form = typeof EMPTY;

export function ArriveForm({ safety }: { safety: string }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [done, setDone] = useState('');

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const err = (k: string) => problem?.fieldErrors[k];
  const text = (k: keyof Form, label: string, extra: Partial<React.ComponentProps<typeof Field>> = {}) => (
    <Field label={label} name={k} required value={f[k] as string} onChange={(e) => set(k, e.target.value as never)} error={err(k)} {...extra} />
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setProblem(null); setDone('');
    try {
      await send('POST', '/api/drivers', f);
      setDone(`${f.truckLicensePlate.toUpperCase()} checked in. It now shows at the dock.`);
      setF(EMPTY);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      router.refresh();
    } catch (er) {
      setProblem(er as Problem);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 space-y-5">
      {problem && <Notice>{problem.message}</Notice>}
      {done && <Notice tone="go">{done}</Notice>}

      <Sheet className="space-y-4 p-4 sm:p-5">
        <p className="tag !text-ink">Driver</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('fullName', 'Driver name', { autoComplete: 'off' })}
          {text('phone', 'Phone number', { type: 'tel', inputMode: 'tel' })}
          {text('driverLicense', "Driver's licence", { mono: true })}
          {text('companyName', 'Carrier / company')}
        </div>
      </Sheet>

      <Sheet className="space-y-4 p-4 sm:p-5">
        <p className="tag !text-ink">Truck and appointment</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('truckLicensePlate', 'Truck licence plate', { mono: true })}
          {text('scacCode', 'SCAC code', { mono: true, maxLength: 4, hint: '2 to 4 letters' })}
          {text('truckNumber', 'Truck No.', { mono: true })}
          {text('appointmentNumber', 'Appointment No.', { mono: true })}
          <Choice label="Vehicle type" required options={VEHICLE_TYPES} value={f.vehicleType} onChange={(e) => set('vehicleType', e.target.value)} error={err('vehicleType')} />
          <Choice label="Visit reason" required options={VISIT_REASONS} value={f.visitReason} onChange={(e) => set('visitReason', e.target.value)} error={err('visitReason')} />
        </div>
        <Pick label="Load" value={f.purpose} onChange={(v) => set('purpose', v)} error={err('purpose')}
          options={[{ value: 'Live', text: 'Live (driver waits)' }, { value: 'Drop', text: 'Drop (trailer stays)' }]} />
      </Sheet>

      <Sheet className="space-y-4 p-4 sm:p-5">
        <p className="tag !text-ink">Trailer and seal IN</p>
        <Check label="Bobtail" hint="Tractor only, no trailer: nothing to record here." checked={f.bobtail} onChange={(v) => set('bobtail', v)} />
        {!f.bobtail && (
          <>
            {text('trailerNoIn', 'Trailer No. IN', { mono: true })}
            <Check label="Trailer arrived empty" hint="No seal when the trailer is empty." checked={f.arrivedEmpty} onChange={(v) => set('arrivedEmpty', v)} />
            {!f.arrivedEmpty && text('sealNoIn', 'Seal No. IN', { mono: true })}
          </>
        )}
      </Sheet>

      <Check label="Safety rules explained to the driver" hint={safety} checked={f.safetyAccepted}
        onChange={(v) => set('safetyAccepted', v)} error={err('safetyAccepted')} />

      <Button tone="go" big className="w-full" disabled={busy}>{busy ? 'Checking in…' : 'Check in driver'}</Button>
    </form>
  );
}
