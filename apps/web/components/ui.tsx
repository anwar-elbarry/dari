'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'dark' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 font-display text-sm font-bold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800',
        variant === 'dark' && 'bg-ink text-white hover:bg-carbon',
        variant === 'secondary' && 'border border-bone bg-white px-5 text-ink hover:bg-mercury',
        variant === 'ghost' && 'px-4 text-carbon hover:bg-mercury',
        variant === 'danger' && 'px-4 text-danger hover:bg-danger-soft',
        className,
      )}
    />
  );
}

const control =
  'block w-full min-h-11 rounded-input border bg-white px-3 text-base text-ink outline-none transition-shadow duration-150 placeholder:text-ash focus:border-brand-600 focus:shadow-focus aria-[invalid=true]:border-danger';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(control, 'border-line-strong', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(control, 'border-line-strong', props.className)} />;
}

/** Label + control + hint + error, wired for screen readers. */
export function Field({ id, label, hint, error, optional, children }: { id: string; label: string; hint?: string; error?: string; optional?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
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

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'rounded-card border px-4 py-3 text-sm',
        tone === 'error' && 'border-danger/20 bg-danger-soft text-danger',
        tone === 'success' && 'border-success/20 bg-success-soft text-success',
        tone === 'info' && 'border-bone bg-white text-carbon',
      )}
    >
      {children}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-card border border-bone bg-white p-5 shadow-sm sm:p-7', className)}>{children}</div>;
}

export function Badge({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'stone'; children: ReactNode }) {
  // Status pill: the word carries the meaning, the colour and dot only reinforce it.
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tone === 'green' && 'bg-success-soft text-success',
        tone === 'amber' && 'bg-warning-soft text-warning',
        tone === 'red' && 'bg-danger-soft text-danger',
        tone === 'stone' && 'bg-mercury text-carbon',
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
