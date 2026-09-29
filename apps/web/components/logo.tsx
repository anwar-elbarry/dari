import { useId } from 'react';

/** Mark geometry, 64 × 64 units. Source of truth: brand/generate.py (Badge R). Keep both in sync. */
const R_PATH = 'M8 62 V6 H36 A17 17 0 0 1 43.5 38.4 L58 62 H43 L31 42 H23 V62 Z M23 19 V29 H36 A5 5 0 0 0 36 19 Z';

/**
 * RiadTax logo, inline so it needs no image request. `surface` is the colour behind the mark:
 * the badge sits in a ring of that colour. Default: white.
 */
export function Logo({ size = 32, wordmark = true, surface = '#ffffff', tone = 'light', className }: { size?: number; wordmark?: boolean; surface?: string; tone?: 'light' | 'dark'; className?: string }) {
  const id = useId();
  const onDark = tone === 'dark';
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0" stopColor="#ff8a1e" />
            <stop offset="1" stopColor="#ff5a00" />
          </linearGradient>
        </defs>
        <path d={R_PATH} fill={`url(#${id})`} fillRule="evenodd" />
        <rect x="3" y="36" width="28" height="28" rx="8" fill={surface} />
        <rect x="5.5" y="38.5" width="23" height="23" rx="6" fill="#0f0f10" />
        <path d="M10.5 47 L15 51.5 L24 42.5" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11 58.5 V56 M17 58.5 V54 M23 58.5 V51.5" fill="none" stroke="#ff8a1e" strokeWidth="2.8" strokeLinecap="round" />
      </svg>
      {wordmark && (
        <span dir="ltr" className={`font-display text-xl font-extrabold leading-none tracking-[-0.03em] ${onDark ? 'text-white' : 'text-ink'}`}>
          Riad<span className={onDark ? 'text-brand-500' : 'text-brand-600'}>Tax</span>
        </span>
      )}
    </span>
  );
}
