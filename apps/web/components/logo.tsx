import { useId } from 'react';

/**
 * RiadTax mark and wordmark, inline so it follows the brand palette without an image request.
 * Source of truth for the shapes: brand/generate.py — keep both in sync.
 */
export function Logo({ tone = 'light', size = 32, wordmark = true, className }: { tone?: 'light' | 'dark'; size?: number; wordmark?: boolean; className?: string }) {
  const id = useId();
  const onDark = tone === 'dark';
  const riad = onDark ? '#ffffff' : '#1c1917';
  const tax = onDark ? '#ff8a1e' : '#c2500a';
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff8a1e" />
            <stop offset="1" stopColor="#ff5a00" />
          </linearGradient>
        </defs>
        <path
          d="M8 22 A24 24 0 0 1 56 22 V27 A17 17 0 0 1 39 44 H35 L54 62 H20 A12 12 0 0 1 8 50 Z M21 18 V33 H37.5 A7.5 7.5 0 0 0 37.5 18 Z"
          fill={`url(#${id})`}
          fillRule="evenodd"
        />
        <path d="M8 50 V37 H30 V62 H20 A12 12 0 0 1 8 50 Z" fill={onDark ? '#0f0f10' : '#1c1917'} />
        <path d="M13.5 44 L17 47.5 L24.5 40" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 58 V54 M19 58 V50 M25 58 V46" fill="none" stroke="#ff8a1e" strokeWidth="3.6" strokeLinecap="round" />
      </svg>
      {wordmark && (
        <span className="text-lg font-bold leading-none tracking-tight" style={{ color: riad }}>
          Riad
          <span style={{ color: tax }}>Tax</span>
        </span>
      )}
    </span>
  );
}
