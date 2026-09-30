'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { MandatoryField, RegisterProblem, ValidationReport } from '../../lib/types';
import { Alert, Button, Dialog } from '../ui';

/**
 * The incomplete records of a month, by stay, with the missing field named and a way into the guest. Ids and
 * field names only come from the API: no name or document number is on this list.
 */
export function ValidationDialog({ report, month, onClose, onOpenGuest }: { report: ValidationReport | null; month: string; onClose: () => void; onOpenGuest: (guestId: string) => void }) {
  const t = useTranslations('register.validation');
  const tc = useTranslations('common');
  const format = useFormatter();
  const day = (iso: string) => format.dateTime(new Date(iso.slice(0, 10)), { dateStyle: 'medium', timeZone: 'UTC' });

  const text = (p: RegisterProblem) =>
    p.kind === 'MISSING_FIELD'
      ? t('kind.MISSING_FIELD', { fields: (p.fields ?? []).map((f: MandatoryField) => t(`field.${f}`)).join(', ') })
      : t(`kind.${p.kind}`);

  return (
    <Dialog open={report !== null} onClose={onClose} title={t('title', { month })} closeLabel={tc('cancel')}>
      <div className="space-y-4">
        {report && report.problems.length === 0 && <Alert tone="success">{t('none')}</Alert>}
        {report && report.problems.length > 0 && (
          <>
            <p className="text-sm text-slate">{t('intro')}</p>
            <ul className="divide-y divide-bone rounded-card border border-bone">
              {report.problems.map((p, i) => {
                const stay = report.stays[p.bookingId];
                return (
                  <li key={`${p.bookingId}-${p.guestId ?? i}-${p.kind}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      {stay && <p className="text-xs text-slate tabular-nums">{t('stay', { checkIn: day(stay.checkIn), checkOut: day(stay.checkOut) })}</p>}
                      <p className="text-sm font-medium">{text(p)}</p>
                    </div>
                    {p.guestId && (
                      <Button variant="ghost" onClick={() => onOpenGuest(p.guestId!)}>
                        {t('openGuest')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <Button variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
      </div>
    </Dialog>
  );
}
