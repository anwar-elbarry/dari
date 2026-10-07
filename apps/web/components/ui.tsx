'use client';

import Link from 'next/link';
import { useEffect, useId, useRef } from 'react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { buttonBase, buttonVariant, cx, type Variant } from './button-class';

/* Components follow the RiadTax design system: pill buttons and tags, 44px controls, bone borders,
   status colours always with a word. See design/README.md. */

export { buttonClass } from './button-class';

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

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(control, 'min-h-24 py-2', className)} />;
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

/**
 * Bento tile of the dashboard-style screens: large radius, hairline border, soft shadow. The title is an h2 and
 * `action` sits at the end of the header (a selector, a link, a button).
 */
export function Panel({ title, subtitle, action, className, children }: { title?: string; subtitle?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cx('flex flex-col rounded-card-lg border border-bone bg-card p-5 shadow-sm', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="font-display text-base leading-[1.4] font-semibold tracking-[-0.01em] text-ink">{title}</h2>}
            {subtitle && <p className="text-sm text-slate">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Round icon well, the visual anchor of a tile or a list row. Decorative: the text next to it carries the meaning. */
export function IconChip({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'raised' | 'brand' | 'dark' | 'warning' | 'danger'; className?: string }) {
  const style = { neutral: 'border border-bone bg-mist text-ink', raised: 'border border-bone bg-card text-ink', brand: 'bg-primary text-on-primary', dark: 'bg-night text-brand-500', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger' }[tone];
  return <span aria-hidden className={cx('inline-flex size-10 flex-none items-center justify-center rounded-pill', style, className)}>{children}</span>;
}

/** One figure inside a panel: icon, label, big number, optional status. */
export function KpiTile({ icon, label, value, status }: { icon: ReactNode; label: string; value: ReactNode; status?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-bone bg-mist p-4 sm:flex-col sm:items-stretch">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:flex-none">
        <IconChip tone="raised">{icon}</IconChip>
        <p className="text-sm leading-tight text-carbon">{label}</p>
      </div>
      <div className="flex flex-wrap items-end justify-end gap-2 sm:justify-between">
        <p className="font-display text-3xl leading-none font-bold tracking-[-0.03em] text-ink tabular-nums">{value}</p>
        {status}
      </div>
    </div>
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

/**
 * Modal dialog on the native <dialog> element: focus is trapped and Escape closes it by the browser, the page
 * behind is inert, and it is labelled by its title. Clicking the backdrop closes it. `closeLabel` is the
 * accessible name of the close button (translated by the caller).
 */
export function Dialog({ open, onClose, title, closeLabel, children }: { open: boolean; onClose: () => void; title: string; closeLabel: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-card border border-bone bg-card p-0 text-ink shadow-lg backdrop:bg-ink/40"
    >
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto p-5 sm:p-7">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 id={titleId} className="font-display text-xl leading-[1.3] font-semibold tracking-[-0.02em]">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label={closeLabel} className="-me-2 -mt-1 inline-flex size-11 flex-none items-center justify-center rounded-pill text-slate hover:bg-mercury">
              <svg {...ICON} width={20} height={20}>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
