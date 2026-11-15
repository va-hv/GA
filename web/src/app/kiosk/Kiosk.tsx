'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Check, Field, Notice, cx } from '@/components/kit';
import { Barrier, Camera, Check as Tick, Hardhat, Person } from '@/components/glyphs';
import { Problem, send } from '@/lib/client';

type Who = 'VISITOR' | 'CONTRACTOR';
const BLANK = {
  fullName: '', email: '', phone: '', purpose: '', hostName: '', companyName: '', insuranceNumber: '',
  idScanned: false, photoData: null as string | null, safetyAccepted: false,
};
type Form = typeof BLANK;
const STEPS = ['Who are you?', 'Your details', 'Photo', 'Safety'];
const IDLE_MS = 120_000;
const DONE_MS = 12_000;

export function Kiosk({ site, rules, welcome }: { site: string; rules: string[]; welcome: string | null }) {
  const [step, setStep] = useState(0);
  const [who, setWho] = useState<Who | null>(null);
  const [f, setF] = useState<Form>(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ first: string; at: string } | null>(null);

  const reset = useCallback(() => {
    setStep(0); setWho(null); setF(BLANK); setErrors({}); setProblem(''); setDone(null); setBusy(false);
  }, []);

  // Back to the start after a finished check-in, or when someone walks away half way.
  useEffect(() => {
    if (done) { const t = setTimeout(reset, DONE_MS); return () => clearTimeout(t); }
    if (step === 0) return;
    let t = setTimeout(reset, IDLE_MS);
    const poke = () => { clearTimeout(t); t = setTimeout(reset, IDLE_MS); };
    window.addEventListener('pointerdown', poke);
    window.addEventListener('keydown', poke);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', poke); window.removeEventListener('keydown', poke); };
  }, [done, step, reset]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };

  function checkDetails() {
    const e: Record<string, string> = {};
    const need: [keyof Form, string][] = [['fullName', 'Your name'], ['phone', 'Phone number'], ['hostName', 'Who you are visiting'], ['purpose', 'Why you are here']];
    if (who === 'CONTRACTOR') need.push(['companyName', 'Company name'], ['insuranceNumber', 'Insurance number']);
    for (const [k, label] of need) if (!String(f[k]).trim()) e[k] = `${label} is needed`;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'Enter a valid email';
    if (f.phone.trim() && !/^[0-9+()\-. ]{6,}$/.test(f.phone.trim())) e.phone = 'Enter a valid phone number';
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function submit() {
    if (!f.safetyAccepted) { setErrors({ safetyAccepted: 'Please read and accept to continue' }); return; }
    setBusy(true); setProblem('');
    try {
      const r = await send<{ fullName: string; arrivedAt: string }>('POST', '/api/kiosk/check-in', { role: who, ...f });
      setDone({ first: r.fullName.split(' ')[0], at: new Date(r.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    } catch (err) {
      const p = err as Problem;
      setProblem(p.status === 401 ? 'This kiosk is not set up any more. Please ask at reception.' : p.message);
      if (Object.keys(p.fieldErrors).length) {
        setErrors(p.fieldErrors);
        if (!p.fieldErrors.safetyAccepted) setStep(1);
      }
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-6px)] max-w-3xl flex-col px-4 py-5 sm:px-8">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-md bg-ink text-paper"><Barrier width={28} height={28} /></span>
        <div className="min-w-0">
          <p className="truncate text-lg font-black">Welcome to {site}</p>
          <p className="text-sm text-ink-2">{welcome || 'Please sign in before going further'}</p>
        </div>
        {step > 0 && !done && <Button tone="quiet" className="ml-auto" onClick={reset}>Start over</Button>}
      </header>

      {done ? (
        <section className="my-auto py-10 text-center">
          <span className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-go-soft text-go"><Tick width={52} height={52} /></span>
          <h1 className="mt-6 text-4xl font-black tracking-tight">You&apos;re signed in, {done.first}</h1>
          <p className="mt-2 text-xl text-ink-2">Signed in at {done.at}. Please wait here; reception will let your host know.</p>
          <Button tone="go" big className="mt-8" onClick={reset}>Done</Button>
        </section>
      ) : (
        <section className="mt-6 flex-1">
          <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s} className="min-w-0">
                <span className={cx('block h-2 rounded-full', i <= step ? 'bg-signal' : 'bg-rule')} />
                <span className={cx('mt-1 block truncate text-xs font-bold', i === step ? 'text-ink' : 'text-ink-2')}>{s}</span>
              </li>
            ))}
          </ol>
          {problem && <div className="mb-4"><Notice>{problem}</Notice></div>}

          {step === 0 && (
            <h1 className="mb-5 text-4xl font-black tracking-tight">Hello. Are you visiting, or here to work?</h1>
          )}
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {([['VISITOR', 'Visitor', 'Here to meet someone', Person], ['CONTRACTOR', 'Contractor', 'Here to do work on site', Hardhat]] as const).map(([value, title, text, Icon]) => (
                <button key={value} type="button" onClick={() => { setWho(value); setStep(1); }}
                  className="flex min-h-64 flex-col justify-between rounded-xl border-2 border-rule bg-sheet p-6 text-left transition hover:border-signal focus-visible:border-signal">
                  <Icon width={44} height={44} />
                  <span><span className="block text-3xl font-black">{title}</span><span className="text-lg text-ink-2">{text}</span></span>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); if (checkDetails()) setStep(2); }}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Your full name" required autoComplete="name" value={f.fullName} onChange={(e) => set('fullName', e.target.value)} error={errors.fullName} />
                <Field label="Email" type="email" inputMode="email" required autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} error={errors.email} />
                <Field label="Phone" type="tel" inputMode="tel" required autoComplete="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
                <Field label="Who are you visiting?" required value={f.hostName} onChange={(e) => set('hostName', e.target.value)} error={errors.hostName} />
                {who === 'CONTRACTOR' && <>
                  <Field label="Company" required value={f.companyName} onChange={(e) => set('companyName', e.target.value)} error={errors.companyName} />
                  <Field label="Insurance number" required value={f.insuranceNumber} onChange={(e) => set('insuranceNumber', e.target.value)} error={errors.insuranceNumber} />
                </>}
              </div>
              <Field label="Why are you here?" required value={f.purpose} onChange={(e) => set('purpose', e.target.value)} error={errors.purpose} />
              <div className="flex gap-3 pt-2">
                <Button type="button" big onClick={() => setStep(0)}>Back</Button>
                <Button tone="go" big className="flex-1">Next</Button>
              </div>
            </form>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <PhotoTaker photo={f.photoData} onPhoto={(p) => set('photoData', p)} />
              <Check label="I showed my ID to reception" hint="Optional" checked={f.idScanned} onChange={(v) => set('idScanned', v)} />
              <div className="flex gap-3 pt-2">
                <Button type="button" big onClick={() => setStep(1)}>Back</Button>
                <Button tone="go" big className="flex-1" onClick={() => setStep(3)}>{f.photoData ? 'Next' : 'Skip photo'}</Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <ol className="space-y-2 rounded-lg border-2 border-rule bg-sheet p-5">
                {rules.map((line, i) => (
                  <li key={line} className="flex gap-3 text-lg"><span className="font-mono font-black text-signal">{i + 1}</span><span>{line}</span></li>
                ))}
              </ol>
              <Check label="I have read and will follow these safety rules" checked={f.safetyAccepted} onChange={(v) => set('safetyAccepted', v)} error={errors.safetyAccepted} />
              <div className="flex gap-3 pt-2">
                <Button type="button" big onClick={() => setStep(2)}>Back</Button>
                <Button tone="go" big className="flex-1" disabled={busy} onClick={submit}>{busy ? 'Signing in…' : 'Sign me in'}</Button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

/** The tablet camera. Optional: if there is no camera or permission is refused, the visitor just skips it. */
function PhotoTaker({ photo, onPhoto }: { photo: string | null; onPhoto: (p: string | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<'off' | 'on' | 'none'>('off');

  const stop = useCallback(() => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; }, []);
  useEffect(() => stop, [stop]);

  async function start() {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      if (video.current) { video.current.srcObject = stream.current; await video.current.play(); }
      setState('on');
    } catch { setState('none'); }
  }

  function snap() {
    const v = video.current;
    if (!v) return;
    const c = document.createElement('canvas');
    c.width = 480; c.height = Math.round((480 * (v.videoHeight || 480)) / (v.videoWidth || 640));
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
    onPhoto(c.toDataURL('image/jpeg', 0.7));
    stop(); setState('off');
  }

  return (
    <div className="rounded-lg border-2 border-rule bg-sheet p-5">
      <p className="text-xl font-extrabold">A photo for your visitor record</p>
      <p className="text-ink-2">Security uses it to know who is on site. It is optional.</p>
      <div className="mt-4 grid place-items-center overflow-hidden rounded-lg bg-sheet-2" style={{ aspectRatio: '4 / 3', maxHeight: 360 }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="Your photo" className="h-full w-full object-cover" />
        ) : (
          <>
            <video ref={video} playsInline muted className={cx('h-full w-full object-cover', state !== 'on' && 'hidden')} />
            {state !== 'on' && <Camera width={56} height={56} className="text-ink-2" />}
          </>
        )}
      </div>
      {state === 'none' && <p className="mt-2 text-sm font-semibold text-wait">No camera available on this tablet. You can skip this step.</p>}
      <div className="mt-4 flex gap-3">
        {photo ? <Button big onClick={() => { onPhoto(null); start(); }}>Retake</Button>
          : state === 'on' ? <Button tone="go" big onClick={snap}>Take photo</Button>
          : <Button big onClick={start}><Camera /> Turn on camera</Button>}
      </div>
    </div>
  );
}
