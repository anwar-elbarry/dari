'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'secondary' && 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-100',
        variant === 'ghost' && 'text-stone-700 hover:bg-stone-100',
        variant === 'danger' && 'text-red-700 hover:bg-red-50',
        className,
      )}
    />
  );
}

const control =
  'block w-full min-h-11 rounded-lg border bg-white px-3 text-base text-stone-900 shadow-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100 aria-[invalid=true]:border-red-500';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(control, 'border-stone-300', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(control, 'border-stone-300', props.className)} />;
}

/** Label + control + hint + error, wired for screen readers. */
export function Field({ id, label, hint, error, optional, children }: { id: string; label: string; hint?: string; error?: string; optional?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
        {optional && <span className="ml-1 font-normal text-stone-500">({optional})</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-stone-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700">
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
        'rounded-lg border px-4 py-3 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-800',
        tone === 'success' && 'border-brand-100 bg-brand-50 text-brand-800',
        tone === 'info' && 'border-stone-200 bg-white text-stone-700',
      )}
    >
      {children}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-stone-200 bg-white p-5 shadow-sm', className)}>{children}</div>;
}

export function Badge({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'stone'; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        tone === 'green' && 'bg-emerald-50 text-emerald-800',
        tone === 'amber' && 'bg-amber-50 text-amber-800',
        tone === 'red' && 'bg-red-50 text-red-800',
        tone === 'stone' && 'bg-stone-100 text-stone-700',
      )}
    >
      {children}
    </span>
  );
}
