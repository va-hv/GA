// Gatehouse building blocks. Presentation only; no data fetching here.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

type Tone = 'go' | 'plain' | 'quiet' | 'stop';
const TONES: Record<Tone, string> = {
  go: 'bg-signal text-signal-ink border-signal hover:brightness-110',
  plain: 'bg-sheet text-ink border-rule-strong hover:bg-sheet-2',
  quiet: 'bg-transparent text-ink-2 border-transparent hover:text-ink hover:bg-sheet-2',
  stop: 'bg-sheet text-stop border-stop/60 hover:bg-stop-soft',
};

export function Button({ tone = 'plain', big, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; big?: boolean }) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md border-2 font-bold transition disabled:cursor-not-allowed disabled:opacity-50',
        big ? 'min-h-14 px-6 text-lg' : 'min-h-10 px-4 text-sm',
        TONES[tone],
        className,
      )}
    />
  );
}

export function Field({ label, error, hint, className, mono, ...rest }: InputHTMLAttributes<HTMLInputElement> & {
  label: string; error?: string; hint?: string; mono?: boolean;
}) {
  const id = rest.id ?? rest.name ?? label.replace(/\W+/g, '-').toLowerCase();
  return (
    <label htmlFor={id} className={cx('block', className)}>
      <span className="tag">{label}{rest.required && <span className="text-signal"> *</span>}</span>
      <input
        id={id}
        {...rest}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        className={cx(
          'mt-1 block w-full rounded-md border-2 bg-sheet px-3 py-2.5 text-base text-ink placeholder:text-ink-2/60',
          error ? 'border-stop' : 'border-rule focus:border-signal',
          mono && 'font-mono uppercase tracking-wider',
        )}
      />
      {error ? <span id={`${id}-err`} className="mt-1 block text-sm font-semibold text-stop">{error}</span>
        : hint ? <span className="mt-1 block text-sm text-ink-2">{hint}</span> : null}
    </label>
  );
}

export function Choice({ label, error, options, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string; error?: string; options: readonly string[];
}) {
  const id = rest.id ?? rest.name ?? label.replace(/\W+/g, '-').toLowerCase();
  return (
    <label htmlFor={id} className={cx('block', className)}>
      <span className="tag">{label}{rest.required && <span className="text-signal"> *</span>}</span>
      <select
        id={id}
        {...rest}
        aria-invalid={!!error}
        className={cx('mt-1 block w-full rounded-md border-2 bg-sheet px-3 py-2.5 text-base text-ink', error ? 'border-stop' : 'border-rule focus:border-signal')}
      >
        <option value="">Choose…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {error && <span className="mt-1 block text-sm font-semibold text-stop">{error}</span>}
    </label>
  );
}

/** Two-way choice drawn as a pair of big buttons (works with gloves). */
export function Pick<T extends string>({ label, value, options, onChange, error }: {
  label: string; value: T | ''; options: { value: T; text: string }[]; onChange: (v: T) => void; error?: string;
}) {
  return (
    <fieldset>
      <legend className="tag">{label}</legend>
      <div className="mt-1 grid grid-flow-col auto-cols-fr gap-2">
        {options.map((o) => (
          <button
            type="button"
            key={o.value}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              'min-h-11 rounded-md border-2 px-3 text-sm font-bold transition',
              value === o.value ? 'border-ink bg-ink text-paper' : 'border-rule bg-sheet text-ink hover:border-rule-strong',
            )}
          >
            {o.text}
          </button>
        ))}
      </div>
      {error && <span className="mt-1 block text-sm font-semibold text-stop">{error}</span>}
    </fieldset>
  );
}

export function Check({ label, hint, checked, onChange, error }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; error?: string;
}) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-3 rounded-md border-2 bg-sheet p-3', error ? 'border-stop' : checked ? 'border-ink' : 'border-rule')}>
      <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--signal)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-bold">{label}</span>
        {hint && <span className="block text-sm text-ink-2">{hint}</span>}
        {error && <span className="block text-sm font-semibold text-stop">{error}</span>}
      </span>
    </label>
  );
}

/** Anything copied off a truck: shown like a plate so it is easy to compare at the gate. */
export function Plate({ children, dim }: { children: ReactNode; dim?: boolean }) {
  if (children === null || children === undefined || children === '') return <span className="text-ink-2">—</span>;
  return (
    <span className={cx('inline-block whitespace-nowrap rounded-[3px] border-2 bg-plate px-1.5 py-0.5 font-mono text-[0.8rem] font-bold uppercase leading-none tracking-wider',
      dim ? 'border-rule text-ink-2' : 'border-ink text-ink')}>
      {children}
    </span>
  );
}

export type StampKind = 'in' | 'dock' | 'cleared' | 'out' | 'visitor' | 'contractor' | 'driver';
const STAMPS: Record<StampKind, [string, string]> = {
  in: ['On site', 'text-info border-info bg-info-soft'],
  dock: ['At the dock', 'text-info border-info bg-info-soft'],
  cleared: ['Cleared · to gate', 'text-wait border-wait bg-wait-soft'],
  out: ['Left', 'text-ink-2 border-rule-strong bg-sheet-2'],
  visitor: ['Visitor', 'text-ink border-rule-strong bg-sheet'],
  contractor: ['Contractor', 'text-ink border-rule-strong bg-sheet'],
  driver: ['Driver', 'text-ink border-rule-strong bg-sheet'],
};

/** Status always in words; the colour only backs it up. */
export function Stamp({ kind, label }: { kind: StampKind; label?: string }) {
  const [text, colours] = STAMPS[kind];
  return (
    <span className={cx('inline-block whitespace-nowrap rounded-sm border-2 px-1.5 py-0.5 text-[0.68rem] font-extrabold uppercase tracking-[0.1em]', colours)}>
      {label ?? text}
    </span>
  );
}

export function Notice({ tone = 'stop', children }: { tone?: 'stop' | 'go' | 'wait' | 'info'; children: ReactNode }) {
  const t = { stop: 'border-stop bg-stop-soft text-stop', go: 'border-go bg-go-soft text-go', wait: 'border-wait bg-wait-soft text-wait', info: 'border-info bg-info-soft text-info' }[tone];
  return <div role={tone === 'stop' ? 'alert' : 'status'} className={cx('rounded-md border-l-4 px-4 py-3 text-sm font-semibold', t)}>{children}</div>;
}

export function Sheet({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-lg border-2 border-rule bg-sheet', className)}>{children}</section>;
}

export function SectionHead({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink pb-2">
      <h2 className="text-lg font-extrabold tracking-tight">
        {title}{count !== undefined && <span className="ml-2 font-mono text-base text-ink-2">{count}</span>}
      </h2>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border-2 border-dashed border-rule px-4 py-6 text-center text-sm text-ink-2">{children}</p>;
}
