/* Button classes as plain functions, usable from server components (ui.tsx is a client module). */

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export type Variant = 'primary' | 'dark' | 'light' | 'ghost' | 'ghost-brand' | 'danger';

export const buttonBase =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-pill border font-display text-sm leading-[1.43] font-bold no-underline transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60';
export const buttonVariant: Record<Variant, string> = {
  primary: 'border-transparent bg-primary px-6 text-on-primary hover:bg-primary-hover active:bg-brand-deep',
  dark: 'border-transparent bg-ink px-6 text-canvas hover:bg-carbon',
  light: 'border-transparent bg-canvas px-6 text-ink hover:bg-mercury',
  // Each variant sets its own border colour (two border colours on one element would depend on CSS order).
  ghost: 'border-bone bg-card px-5 text-ink hover:bg-mercury',
  'ghost-brand': 'border-link bg-transparent px-5 text-link hover:bg-brand-50',
  danger: 'border-transparent bg-transparent px-4 text-danger hover:bg-danger-soft',
};

/** Class names of a button, for elements that are not <button> or a Next link (an external <a>). */
export const buttonClass = (variant: Variant = 'primary', className?: string) => cx(buttonBase, buttonVariant[variant], className);
