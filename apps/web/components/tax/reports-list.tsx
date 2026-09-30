'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { taxesTotal } from '../../lib/tax';
import type { TaxReportSummary } from '../../lib/types';
import { Alert, Card, LinkButton, Meta, StatusPill } from '../ui';
import { BetaPill, isBeta, TaxNotice, useMoney, useTaxRules } from './tax-notice';

const TONE = { generated: 'success', outdated: 'warning' } as const;

/** Every tax estimate of the account, grouped by month, newest first. Home of the Accountant; a list for Owner/Manager. */
export function ReportsList() {
  const t = useTranslations('tax');
  const tc = useTranslations('common');
  const format = useFormatter();
  const money = useMoney();
  const { can } = useSession();
  const { rules, state: rulesState, reload } = useTaxRules();
  const [reports, setReports] = useState<TaxReportSummary[] | null>(null);
  const [state, setState] = useState<'ok' | 'failed' | 'unavailable'>('ok');

  useEffect(() => {
    let cancelled = false;
    api<TaxReportSummary[]>('GET', '/tax/reports')
      .then((r) => !cancelled && setReports(r))
      .catch((e) => !cancelled && setState(e instanceof ApiError && e.status === 404 ? 'unavailable' : 'failed'));
    return () => {
      cancelled = true;
    };
  }, []);

  const label = (month: string) => format.dateTime(new Date(`${month}-01`), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const months = [...new Set((reports ?? []).map((r) => r.month))].sort().reverse();
  const anyBeta = !!rules && isBeta(rules, !!reports?.some((r) => r.beta));

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('list.title')}</h1>
        <p className="text-sm text-slate">{t('list.intro')}</p>
      </div>

      {(state === 'unavailable' || rulesState === 'unavailable') && <Alert tone="info">{t('unavailable')}</Alert>}
      {state === 'failed' && <Alert>{t('loadFailed')}</Alert>}
      {rulesState === 'failed' && (
        <Alert>
          {t('noticeFailed')}{' '}
          <button type="button" onClick={() => void reload()} className="font-medium text-link underline">
            {tc('retry')}
          </button>
        </Alert>
      )}
      {rules && <TaxNotice beta={anyBeta} rules={rules} />}

      {rules && reports && reports.length === 0 && (
        <Card className="space-y-1">
          <p className="text-slate">{t('list.empty')}</p>
          {can('report:generate') && <p className="text-sm text-slate">{t('list.emptyManager')}</p>}
        </Card>
      )}

      {rules &&
        months.map((month) => (
          <div key={month} className="space-y-3">
            <h2 className="font-display text-xl font-semibold tracking-[-0.02em] capitalize">{label(month)}</h2>
            <ul className="space-y-3">
              {reports!
                .filter((r) => r.month === month)
                .map((r) => (
                  <li key={r.id}>
                    <Card className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate font-display text-lg font-semibold">{r.propertyName}</h3>
                          <p className="text-sm text-slate">{t('generatedOn', { date: when(r.generatedAt) })}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill tone={TONE[r.status]}>{t(`status.${r.status}`)}</StatusPill>
                          {r.beta && <BetaPill />}
                        </div>
                      </div>
                      <dl className="grid grid-cols-2 gap-3">
                        <div>
                          <dt>
                            <Meta>{t('list.grossBase')}</Meta>
                          </dt>
                          <dd className="font-display text-lg font-bold tabular-nums">{money(r.totals.grossBase)}</dd>
                        </div>
                        <div>
                          <dt>
                            <Meta>{t('list.taxes')}</Meta>
                          </dt>
                          <dd className="font-display text-lg font-bold tabular-nums">{money(taxesTotal(r.totals))}</dd>
                        </div>
                      </dl>
                      {(r.problemCounts.RULE_MISSING ?? 0) > 0 && <p className="text-sm text-slate">{t('list.partial')}</p>}
                      <div>
                        <LinkButton href={`/tax/reports/${r.id}`} variant="ghost">
                          {t('list.open')}
                        </LinkButton>
                      </div>
                    </Card>
                  </li>
                ))}
            </ul>
          </div>
        ))}
    </section>
  );
}
