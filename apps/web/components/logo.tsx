import { useId } from 'react';

/**
 * RiadTax "Badge R" logo, ported from the design system's Logo component.
 * `tone="light"` sits on white/mist (mark on a night tile, "Tax" in olive);
 * `tone="dark"` sits on night (mark alone, "Tax" in lime). `surface` is the colour behind the mark on dark.
 * Use the app icon below 24px. The wordmark stays left-to-right in Arabic.
 */
const R_PATH = 'M8 62 V6 H36 A17 17 0 0 1 43.5 38.4 L58 62 H43 L31 42 H23 V62 Z M23 19 V29 H36 A5 5 0 0 0 36 19 Z';

export function Logo({ size = 32, wordmark = true, tone = 'light', surface = '#0f0f10' }: { size?: number; wordmark?: boolean; tone?: 'light' | 'dark'; surface?: string }) {
  const gradient = useId();
  const dark = tone === 'dark';
  const mark = (ring: string) => (
    <>
      <defs>
        <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="64" y2="64">
          <stop offset="0" stopColor="#e4f222" />
          <stop offset="1" stopColor="#b9cc00" />
        </linearGradient>
      </defs>
      <path d={R_PATH} fill={`url(#${gradient})`} fillRule="evenodd" />
      <rect x="3" y="36" width="28" height="28" rx="8" fill={ring} />
      <rect x="5.5" y="38.5" width="23" height="23" rx="6" fill="#0f0f10" />
      <path d="M10.5 47 L15 51.5 L24 42.5" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 58.5 V56 M17 58.5 V54 M23 58.5 V51.5" fill="none" stroke="#e4f222" strokeWidth="2.8" strokeLinecap="round" />
    </>
  );
  const svg = (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false">
      {dark ? (
        mark(surface)
      ) : (
        <>
          <rect width="64" height="64" rx="14" fill="#0f0f10" />
          <g transform="translate(7 7) scale(0.78125)">{mark('#0f0f10')}</g>
        </>
      )}
    </svg>
  );
  if (!wordmark) return <span role="img" aria-label="RiadTax" className="inline-flex">{svg}</span>;
  return (
    <span role="img" aria-label="RiadTax" dir="ltr" className="inline-flex items-center" style={{ gap: Math.round(size * 0.3) }}>
      {svg}
      <span className="font-display font-extrabold leading-none" style={{ fontSize: Math.round(size * 0.62), letterSpacing: '-0.03em', color: dark ? '#ffffff' : 'var(--ink)' }}>
        Riad<span style={{ color: dark ? 'var(--brand-500)' : 'var(--brand-700)' }}>Tax</span>
      </span>
    </span>
  );
}
