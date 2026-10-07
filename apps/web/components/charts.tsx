import type { ReactNode } from 'react';
import { niceMax, segments, ticks } from '../lib/chart';

/*
 * Hand-made charts in RiadTax tokens (design/README.md, "Charts"): data in ink or olive, lime never carries a value on
 * its own, and every chart has a text equivalent (a table read by screen readers instead of the drawing).
 */

export interface Bar {
  label: string;
  /** Spelled out for the table, e.g. the full month name. */
  longLabel: string;
  value: number;
  /** Drawn in olive (with `highlightNote` in the legend), e.g. the current month. */
  highlight?: boolean;
}

export function BarChart({ bars, caption, header, highlightNote }: { bars: Bar[]; caption: string; header: [string, string]; highlightNote?: string }) {
  const max = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  return (
    <figure className="space-y-3">
      <div aria-hidden className="relative grid h-48 grid-cols-[2rem_1fr] gap-2">
        <div className="relative text-end font-mono text-[10px] text-slate">
          {ticks(max).map((v) => (
            <span key={v} className="absolute end-0 -translate-y-1/2 tabular-nums" style={{ top: `${100 - (v / max) * 100}%` }}>
              {v}
            </span>
          ))}
        </div>
        <div className="relative">
          {ticks(max).map((v) => (
            <span key={v} className="absolute inset-x-0 border-t border-dashed border-cloud" style={{ top: `${100 - (v / max) * 100}%` }} />
          ))}
          <div className="relative grid h-full grid-cols-12 items-end gap-1.5 sm:gap-2.5">
            {bars.map((b) => (
              <div key={b.longLabel} className="group relative flex h-full items-end justify-center">
                {b.value > 0 && (
                  <span className="absolute -translate-y-full pb-1 font-mono text-[10px] text-carbon tabular-nums opacity-0 transition-opacity group-hover:opacity-100" style={{ bottom: `${(b.value / max) * 100}%` }}>
                    {b.value}
                  </span>
                )}
                <div className={`w-full max-w-7 rounded-t-[6px] ${b.highlight ? 'bg-brand-700' : 'bg-ink'}`} style={{ height: `${(b.value / max) * 100}%`, minHeight: b.value > 0 ? 3 : 0 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div aria-hidden className="grid grid-cols-[2rem_1fr] gap-2">
        <span />
        <div className="grid grid-cols-12 gap-1.5 text-center font-mono text-[10px] tracking-[0.04em] text-slate uppercase sm:gap-2.5">
          {bars.map((b) => (
            <span key={b.longLabel} className={b.highlight ? 'font-semibold text-ink' : ''}>
              {b.label}
            </span>
          ))}
        </div>
      </div>
      {highlightNote && (
        <p aria-hidden className="flex items-center gap-2 text-xs text-slate">
          <span className="size-2.5 rounded-[3px] bg-brand-700" />
          {highlightNote}
        </p>
      )}
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{header[0]}</th>
            <th scope="col">{header[1]}</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.longLabel}>
              <th scope="row">{b.longLabel}</th>
              <td>{b.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export interface Slice {
  label: string;
  value: number;
  /** A Tailwind stroke class from the tokens, e.g. `stroke-ink`; the legend dot uses the matching `bg-` class. */
  stroke: string;
  fill: string;
}

const R = 42;
const C = 2 * Math.PI * R;

/** Donut with the total in the middle and a legend that carries every value as text. */
export function Donut({ slices, center, centerLabel, formatShare }: { slices: Slice[]; center: ReactNode; centerLabel: string; formatShare: (fraction: number) => string }) {
  const parts = segments(slices.map((s) => s.value));
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col">
      <div className="relative size-40 flex-none">
        <svg aria-hidden viewBox="0 0 100 100" className="size-full -rotate-90">
          <circle cx="50" cy="50" r={R} fill="none" strokeWidth="12" className="stroke-mercury" />
          {slices.map((s, i) =>
            parts[i]!.size > 0 ? (
              <circle
                key={s.label}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                strokeWidth="12"
                className={s.stroke}
                strokeDasharray={`${Math.max(0, parts[i]!.size * C - (parts[i]!.size < 1 ? 1.5 : 0))} ${C}`}
                strokeDashoffset={-parts[i]!.start * C}
              />
            ) : null,
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-display text-2xl leading-none font-bold tracking-[-0.03em] tabular-nums">{center}</span>
          <span className="mt-1 text-xs text-slate">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2.5">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={`size-2.5 flex-none rounded-full ${s.fill}`} />
              <span className="truncate text-carbon">{s.label}</span>
            </span>
            <span className="flex-none tabular-nums">
              <span className="font-semibold text-ink">{s.value}</span>
              {total > 0 && <span className="ms-1.5 text-slate">{formatShare(parts[i]!.size)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
