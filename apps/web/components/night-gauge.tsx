import { useTranslations } from 'next-intl';
import type { Level } from '../lib/types';
import { StatusPill } from './ui';

const FILL: Record<Level, string> = { green: 'bg-success', amber: 'bg-warning', red: 'bg-danger' };
const TONE = { green: 'success', amber: 'warning', red: 'danger' } as const;

/**
 * Night counter as a meter with the two thresholds marked. Thresholds and the limit come from the
 * rules data (API), never from this component. Colour only reinforces the word in the pill.
 */
export function NightGauge({ nights, level, thresholds, label }: { nights: number; level: Level; thresholds: { amber: number; red: number; cap: number }; label: string }) {
  const t = useTranslations('dashboard');
  const pct = (n: number) => Math.min(100, (n / thresholds.cap) * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-2xl font-bold tracking-[-0.02em] tabular-nums">
          {nights} <span className="text-base font-semibold text-slate">/ {thresholds.cap}</span>
        </p>
        <StatusPill tone={TONE[level]}>{t(`levels.${level}`)}</StatusPill>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={thresholds.cap}
        aria-valuenow={Math.min(nights, thresholds.cap)}
        aria-valuetext={`${nights} / ${thresholds.cap}`}
        className="relative h-2.5 overflow-hidden rounded-pill bg-mercury"
      >
        <div className={`h-full rounded-pill ${FILL[level]}`} style={{ width: `${pct(nights)}%` }} />
        {[thresholds.amber, thresholds.red].map((n) => (
          <span key={n} aria-hidden className="absolute inset-y-0 w-0.5 bg-canvas" style={{ insetInlineStart: `${pct(n)}%` }} />
        ))}
      </div>
    </div>
  );
}
