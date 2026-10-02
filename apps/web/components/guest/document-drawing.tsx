/**
 * Schematic drawings that show the guest where the machine-readable lines are: at the bottom of a passport's photo
 * page, and on the back of an ID card. Shapes only, no text or likeness, so nothing here resembles a real document.
 */
export type DocChoice = 'PASSPORT' | 'CIN';

/** One machine-readable line: a run of marks on the highlighted band. */
function MrzLine({ x, y, width }: { x: number; y: number; width: number }) {
  const marks = Math.floor(width / 7);
  return (
    <g className="fill-on-primary">
      {Array.from({ length: marks }, (_, i) => (
        <rect key={i} x={x + i * 7} y={y} width={4.5} height={5} rx={0.8} opacity={i > marks * 0.55 ? 0.45 : 1} />
      ))}
    </g>
  );
}

function TextBars({ x, y, widths }: { x: number; y: number; widths: number[] }) {
  return (
    <g className="fill-mercury">
      {widths.map((w, i) => (
        <rect key={i} x={x} y={y + i * 11} width={w} height={5} rx={2.5} />
      ))}
    </g>
  );
}

export function DocumentDrawing({ kind, label }: { kind: DocChoice; label: string }) {
  if (kind === 'PASSPORT') {
    return (
      <svg viewBox="0 0 240 200" role="img" aria-label={label} className="mx-auto block h-auto w-full max-w-60">
        {/* Upper page of the open booklet, then the photo page. */}
        <rect x="20" y="8" width="200" height="88" rx="8" className="fill-mist stroke-line-strong" strokeWidth="1.5" />
        <TextBars x={36} y={26} widths={[120, 90, 140]} />
        <rect x="20" y="100" width="200" height="92" rx="8" className="fill-card stroke-line-strong" strokeWidth="1.5" />
        <rect x="32" y="110" width="40" height="46" rx="4" className="fill-mercury" />
        <TextBars x={82} y={112} widths={[90, 70, 110, 60]} />
        <rect x="26" y="158" width="188" height="30" rx="5" className="fill-primary" />
        <MrzLine x={33} y={163} width={176} />
        <MrzLine x={33} y={176} width={176} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 240 160" role="img" aria-label={label} className="mx-auto block h-auto w-full max-w-60">
      <rect x="14" y="12" width="212" height="136" rx="12" className="fill-card stroke-line-strong" strokeWidth="1.5" />
      <TextBars x={30} y={28} widths={[110, 150, 90, 130, 70]} />
      <rect x="22" y="96" width="196" height="44" rx="6" className="fill-primary" />
      <MrzLine x={30} y={102} width={182} />
      <MrzLine x={30} y={115} width={182} />
      <MrzLine x={30} y={128} width={182} />
    </svg>
  );
}
