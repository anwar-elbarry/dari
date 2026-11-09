'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ApiError, apiBlob } from '../../lib/api';
import { portfolioFilename, portfolioTaxes } from '../../lib/tax';
import type { PortfolioSummary, TaxPortfolio } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { downloadBlob } from '../checkin/share';
import { Alert, Button, Field, Panel, Select, StatusPill } from '../ui';
import { BetaPill, useMoney } from './tax-notice';

const YEARS_BACK = 3;

/**
 * Every property of the account over a year or a month, and the Excel file for the accountant. The figures are
 * computed by the API with the same rules as the monthly estimates; the beta wording sits above, on the page.
 */
export function PortfolioPanel() {
  const t = useTranslations('tax.portfolio');
  const tt = useTranslations('tax');
  const format = useFormatter();
  const money = useMoney();
  const action = useSubmit();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState<number | null>(null);
  const [data, setData] = useState<TaxPortfolio | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');

  const query = `year=${year}${month ? `&month=${month}` : ''}`;
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    api<TaxPortfolio>('GET', `/tax/portfolio?${query}`)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setState('ok');
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setState(e instanceof ApiError && e.code === 'MONTH_NOT_STARTED' ? 'ok' : 'failed');
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function download() {
    const blob = await action.run(() => apiBlob(`/tax/portfolio/xlsx?${query}`));
    if (blob) downloadBlob(blob, portfolioFilename(year, month));
  }

  const monthName = (m: number) => format.dateTime(new Date(Date.UTC(2000, m - 1, 1)), { month: 'long', timeZone: 'UTC' });
  const amount = (cents: number | null) => (cents === null ? <StatusPill tone="warning">{tt('notComputed')}</StatusPill> : money(cents));
  const cells = (s: PortfolioSummary) => (
    <>
      <td className="px-3 py-2 text-end whitespace-nowrap tabular-nums">{s.nights}</td>
      <td className="px-3 py-2 text-end whitespace-nowrap tabular-nums">{amount(s.figures.gross_base)}</td>
      <td className="px-3 py-2 text-end whitespace-nowrap tabular-nums">{amount(portfolioTaxes(s.figures))}</td>
      <td className="px-3 py-2 text-end whitespace-nowrap tabular-nums">{t('current', { current: s.reportsCurrent, months: s.months })}</td>
    </>
  );

  return (
    <Panel title={t('title')} subtitle={t('intro')} action={data?.beta ? <BetaPill /> : undefined}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="portfolio-year" label={t('year')}>
            <Select id="portfolio-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: YEARS_BACK }, (_, i) => thisYear - i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="portfolio-month" label={t('month')}>
            <Select id="portfolio-month" value={month ?? ''} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('wholeYear')}</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={download} disabled={action.pending || !data || data.properties.length === 0}>
            {action.pending ? t('downloading') : t('download')}
          </Button>
        </div>

        {action.error && <Alert>{action.error}</Alert>}
        {state === 'failed' && <Alert>{tt('loadFailed')}</Alert>}
        {state === 'ok' && !data && <p className="text-sm text-slate">{t('notStarted')}</p>}
        {data && data.properties.length === 0 && <p className="text-sm text-slate">{t('empty')}</p>}

        {data && data.properties.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">{t('caption')}</caption>
              <thead>
                <tr className="border-b border-bone text-start text-slate">
                  <th scope="col" className="px-3 py-2 text-start font-medium">
                    {t('property')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">
                    {t('nights')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">
                    {t('grossBase')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">
                    {t('taxes')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">
                    {t('reports')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.properties.map((p) => (
                  <tr key={p.propertyId} className="border-b border-bone">
                    <th scope="row" className="px-3 py-2 text-start font-medium">
                      <span className="block">{p.propertyName}</span>
                      <span className="block text-xs font-normal text-slate">{p.ownerName}</span>
                    </th>
                    {cells(p.summary)}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <th scope="row" className="px-3 py-2 text-start">
                    {t('total')}
                  </th>
                  {cells(data.total)}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {data && data.total.problems > 0 && <p className="text-sm text-slate">{t('problems', { count: data.total.problems })}</p>}
      </div>
    </Panel>
  );
}
