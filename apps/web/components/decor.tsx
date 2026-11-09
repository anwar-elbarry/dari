/** Decorative rings for lime panels (brand-deep on the brand fill). No meaning, hidden from assistive tech. */
export function Rings({ className = '-end-20 -bottom-24' }: { className?: string }) {
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 200 200" className={`pointer-events-none absolute size-72 text-brand-deep opacity-40 rtl:-scale-x-100 ${className}`}>
      <g fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="round">
        <path d="M30 150a80 80 0 1 1 140 0" />
        <path d="M62 150a48 48 0 1 1 86-30" opacity="0.6" />
      </g>
    </svg>
  );
}
