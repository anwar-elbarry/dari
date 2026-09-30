'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { TaxMissing, TaxProblem, TaxProblemCode } from '../../lib/types';
import { Alert, Button, Dialog } from '../ui';
import type { AmountsTarget } from './amounts-dialog';

const STAY_CODES = ['NO_AMOUNTS', 'TAXE_SEJOUR_MISSING', 'PARTY_SIZE_MISSING'] as const;

/**
 * What is missing for a month, by kind. Stays are named by their dates only (the payload carries ids and rule
 * keys, never a guest name) and lead to the amounts form; rules are named by key.
 */
export function MissingDialog({ data, month, propertyId, onClose, onEnter }: { data: TaxMissing | null; month: string; propertyId: string; onClose: () => void; onEnter: (target: AmountsTarget) => void }) {
  const t = useTranslations('tax.missing');
  const tc = useTranslations('common');
  const format = useFormatter();
  const fmt = (iso: string) => format.dateTime(new Date(iso.slice(0, 10)), { dateStyle: 'medium', timeZone: 'UTC' });

  const byCode = (code: TaxProblemCode): TaxProblem[] => data?.problems.filter((p) => p.code === code) ?? [];
  const ruleKeys = [...new Set(byCode('RULE_MISSING').map((p) => p.rule).filter((r): r is string => !!r))];

  return (
    <Dialog open={data !== null} onClose={onClose} title={t('title', { month })} closeLabel={tc('cancel')}>
      <div className="space-y-4">
        {data && data.problems.length === 0 && <Alert tone="success">{t('none')}</Alert>}
        {data && data.problems.length > 0 && <p className="text-sm text-slate">{t('intro')}</p>}

        {data &&
          STAY_CODES.map((code) => {
            const problems = byCode(code).filter((p) => p.bookingId);
            if (problems.length === 0) return null;
            return (
              <div key={code} className="space-y-2">
                <div>
                  <h3 className="font-display text-base font-semibold">{t(`group.${code}.title`)}</h3>
                  <p className="text-sm text-slate">{t(`group.${code}.help`)}</p>
                </div>
                <ul className="divide-y divide-bone rounded-card border border-bone">
                  {problems.map((p) => {
                    const stay = data.stays[p.bookingId!];
                    return (
                      <li key={`${code}-${p.bookingId}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                        <p className="text-sm font-medium tabular-nums">{stay ? t('stay', { checkIn: fmt(stay.checkIn), checkOut: fmt(stay.checkOut) }) : t('stayNoDates')}</p>
                        {stay && (
                          <Button variant="ghost" onClick={() => onEnter({ bookingId: p.bookingId!, propertyId, checkIn: stay.checkIn, checkOut: stay.checkOut })}>
                            {code === 'PARTY_SIZE_MISSING' ? t('enterParty') : t('enter')}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

        {ruleKeys.length > 0 && (
          <div className="space-y-2">
            <div>
              <h3 className="font-display text-base font-semibold">{t('group.RULE_MISSING.title')}</h3>
              <p className="text-sm text-slate">{t('ruleHelp')}</p>
            </div>
            <ul className="divide-y divide-bone rounded-card border border-bone">
              {ruleKeys.map((key) => (
                <li key={key} className="px-3 py-2.5 font-mono text-sm">
                  <bdi dir="ltr">{key}</bdi>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
      </div>
    </Dialog>
  );
}
