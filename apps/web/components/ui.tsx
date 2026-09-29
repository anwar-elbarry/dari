'use client';

import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/* Components follow the RiadTax design system: pill buttons and tags, 44px controls, bone borders,
   status colours always with a word. See design/README.md. */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'dark' | 'ghost' | 'ghost-brand' | 'danger';

const buttonBase =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-pill border border-transparent font-display text-sm leading-[1.43] font-bold no-underline transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60';
const buttonVariant: Record<Variant, string> = {
  primary: 'bg-primary px-6 text-on-primary hover:bg-primary-hover active:bg-brand-deep',
  dark: 'bg-ink px-6 text-canvas hover:bg-carbon',
  ghost: 'border-bone bg-transparent px-5 text-ink hover:bg-mercury',
  'ghost-brand': 'border-link bg-transparent px-5 text-link hover:bg-brand-50',
  danger: 'bg-transparent px-4 text-danger hover:bg-danger-soft',
};

export function Button({ variant = 'primary', className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} {...props} className={cx(buttonBase, buttonVariant[variant], className)} />;
}

/** A link that looks like a button (navigation, not an action). */
export function LinkButton({ variant = 'primary', className, ...props }: React.ComponentProps<typeof Link> & { variant?: Variant } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <Link {...props} className={cx(buttonBase, buttonVariant[variant], className)} />;
}

const control =
  'block min-h-11 w-full rounded-input border border-line-strong bg-canvas px-3 text-base text-ink outline-none transition-shadow placeholder:text-ash focus:border-focus focus:shadow-[var(--shadow-focus)] aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:bg-mist disabled:text-slate';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return <input {...props} className={cx(control, className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(control, className)} />;
}

/** Label above the control (never a placeholder), then hint or error, wired for screen readers. */
export function Field({ id, label, hint, error, optional, children }: { id: string; label: string; hint?: string; error?: string; optional?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {optional && <span className="ms-1 font-normal text-slate">({optional})</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-slate">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** aria props for a control inside <Field>. */
export function fieldAria(id: string, error?: string, hint?: string) {
  return {
    id,
    name: id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

const ICON = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' } as const;

/** Notice on a soft fill, with an icon so colour never carries the meaning alone. */
export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode }) {
  const style = {
    error: 'bg-danger-soft text-ink [&_svg]:text-danger',
    success: 'bg-success-soft text-ink [&_svg]:text-success',
    warning: 'bg-warning-soft text-ink [&_svg]:text-warning',
    info: 'border border-bone bg-card text-carbon [&_svg]:text-info',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex items-start gap-2.5 rounded-card px-4 py-3 text-sm', style)}>
      <svg {...ICON} className="mt-0.5 flex-none">
        {tone === 'success' ? <path d="M4 12.5l5 5L20 6.5" /> : tone === 'error' ? <><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16.5h.01" /></> : <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>}
      </svg>
      <div>{children}</div>
    </div>
  );
}

export function Card({ className, onMist, children }: { className?: string; onMist?: boolean; children: ReactNode }) {
  return <section className={cx('rounded-card border border-bone bg-card p-5 sm:p-7', onMist && 'shadow-sm', className)}>{children}</section>;
}

/** State of a property, stay or declaration: dot + word on a soft fill. The word is required. */
export function StatusPill({ tone = 'neutral', children }: { tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; children: ReactNode }) {
  const style = { success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info', neutral: 'bg-mercury text-carbon' }[tone];
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-[3px] text-xs font-semibold', style)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

/** Mono uppercase label above a number. */
export function Meta({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[10px] leading-[1.6] font-medium tracking-[0.08em] text-slate uppercase">{children}</p>;
}

export function StatCard({ label, value, unit, caption }: { label: string; value: ReactNode; unit?: string; caption?: ReactNode }) {
  return (
    <Card>
      <Meta>{label}</Meta>
      <p className="mt-1 font-display text-5xl leading-[1.15] font-bold tracking-[-0.035em] text-ink tabular-nums">
        {value}
        {unit && <small className="ms-1.5 text-xl font-semibold tracking-[-0.02em] text-slate">{unit}</small>}
      </p>
      {caption && <p className="text-sm text-slate">{caption}</p>}
    </Card>
  );
}

export function Tag({ active, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active ? 'true' : 'false'}
      {...props}
      className={cx('inline-flex min-h-8 items-center rounded-pill border px-3.5 font-display text-sm font-bold', active ? 'border-brand-100 bg-brand-50 text-link' : 'border-bone bg-mist text-ink')}
    >
      {children}
    </button>
  );
}

/** Kept for existing screens; new code uses StatusPill. */
export function Badge({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'stone'; children: ReactNode }) {
  return <StatusPill tone={{ green: 'success', amber: 'warning', red: 'danger', stone: 'neutral' }[tone] as 'success'}>{children}</StatusPill>;
}
