'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Button, Card, StatusPill } from '../ui';
import type { Stay } from '../../lib/types';

const day = (iso: string) => new Date(iso.slice(0, 10));

export function useNightsLabel() {
  const t = useTranslations('property');
  return (a: string, b: string) => t('nights', { count: Math.max(1, Math.round((day(b).getTime() - day(a).getTime()) / 86_400_000)) });
}

export function StayRow({ stay, actions }: { stay: Stay; actions?: React.ReactNode }) {
  const t = useTranslations('property');
  const format = useFormatter();
  const nights = useNightsLabel();
  const fmt = (iso: string) => format.dateTime(day(iso), { dateStyle: 'medium', timeZone: 'UTC' });
  const tone = stay.status === 'CANCELLED' ? 'neutral' : stay.classification === 'BOOKING' ? 'success' : stay.classification === 'OWNER_BLOCK' ? 'info' : 'warning';
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-medium tabular-nums">
          {fmt(stay.checkIn)} → {fmt(stay.checkOut)}
        </p>
        <p className="text-sm text-slate">
          {t(`source.${stay.source}`)} · {nights(stay.checkIn, stay.checkOut)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={tone}>{stay.status === 'CANCELLED' ? t('status.CANCELLED') : t(`classification.${stay.classification}`)}</StatusPill>
        {actions}
      </div>
    </li>
  );
}

/** Events the machine could not classify. They do not count until a person decides. */
export function ReviewList({ stays, onDecide, busy }: { stays: Stay[]; onDecide: (id: string, c: 'BOOKING' | 'OWNER_BLOCK') => void; busy: boolean }) {
  const t = useTranslations('property');
  if (stays.length === 0) return null;
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('review')}</h2>
        <p className="mt-1 text-sm text-slate">{t('reviewHelp')}</p>
      </div>
      <ul className="divide-y divide-bone">
        {stays.map((s) => (
          <StayRow
            key={s.id}
            stay={s}
            actions={
              <>
                <Button variant="ghost" onClick={() => onDecide(s.id, 'BOOKING')} disabled={busy}>
                  {t('isBooking')}
                </Button>
                <Button variant="ghost" onClick={() => onDecide(s.id, 'OWNER_BLOCK')} disabled={busy}>
                  {t('isBlock')}
                </Button>
              </>
            }
          />
        ))}
      </ul>
    </Card>
  );
}
