'use client';

import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api, ApiError, apiBlob } from '../../lib/api';
import { useSession } from '../../lib/session';
import { exportFilename, formatBps } from '../../lib/tax';
import type { TaxLine, TaxLineKey, TaxProblemCode, TaxReportDetail } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { downloadBlob, openBlob } from '../checkin/share';
import { Alert, Button, Card, Meta, StatusPill } from '../ui';
import { BetaPill, TaxNotice, useMoney, useTaxRules } from './tax-notice';

const PROBLEM_ORDER: TaxProblemCode[] = ['NO_AMOUNTS', 'TAXE_SEJOUR_MISSING', 'PARTY_SIZE_MISSING', 'RULE_MISSING'];
const HIGHLIGHT: TaxLineKey[] = ['gross_base', 'income_tax', 'vat', 'local_tax'];
const TONE = { generated: 'success', outdated: 'warning' } as const;

/** Amount of a line, or the "not computed" pill (a missing parameter is never shown as zero). */
function useLineAmount() {
  const t = useTranslations('tax');
  const money = useMoney();
  return (line: TaxLine | undefined) => (!line || line.amount === null ? <StatusPill tone="warning">{t('notComputed')}</StatusPill> : money(line.amount));
}

/** The note of a line in words, translated here from the machine-readable `note` and `detail`. */
function useNoteText() {
  const t = useTranslations('tax.note');
  const tp = useTranslations('properties');
  const locale = useLocale();
  return (line: TaxLine): string | null => {
    switch (line.note) {
      case 'not_applicable':
      case 'not_deducted':
        return t(line.note);
      case 'rule_missing':
        return t('rule_missing', { rule: line.detail ?? '' });
      case 'rate_bps':
      case 'catch_up': {
        const rate = formatBps(line.detail ?? '', locale);
        return rate === null ? null : t(line.note === 'rate_bps' ? 'rate' : 'catch_up', { rate });
      }
      case 'residency': {
        const [residency, account] = (line.detail ?? '').split('/');
        if (!tp.has(`residency.${residency}`) || !tp.has(`bankAccountType.${account}`)) return null;
        return t('residency', { residency: tp(`residency.${residency}`), account: tp(`bankAccountType.${account}`) });
      }
      default:
        return null;
    }
  };
}

/**
 * One tax estimate, for Owner/Manager and Accountant (`report:read`). The lines are the pipeline's steps; a line
 * with no amount is "not computed", never zero. Only people who can generate see the way back to the property.
 */
export function ReportDetailScreen({ reportId }: { reportId: string }) {
  const t = useTranslations('tax');
  const tp = useTranslations('properties');
  const tc = useTranslations('common');
  const format = useFormatter();
  const { can } = useSession();
  const { rules, state: rulesState, reload } = useTaxRules();
  const [report, setReport] = useState<TaxReportDetail | null>(null);
  const [state, setState] = useState<'ok' | 'failed' | 'unavailable'>('ok');
  const action = useSubmit();
  const amount = useLineAmount();
  const noteText = useNoteText();
  const manager = can('report:generate');

  useEffect(() => {
    let cancelled = false;
    api<TaxReportDetail>('GET', `/tax/reports/${reportId}`)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setState(e instanceof ApiError && e.status === 404 ? 'unavailable' : 'failed'));
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const monthLabel = (month: string) => format.dateTime(new Date(`${month}-01`), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const backList = (
    <Link href="/reports" className="text-sm font-medium text-link hover:underline">
      ← {t('detail.backList')}
    </Link>
  );

  if (state !== 'ok' || rulesState === 'unavailable') {
    return (
      <section className="space-y-4">
        {backList}
        {state === 'failed' ? <Alert>{t('loadFailed')}</Alert> : <Alert tone="info">{state === 'unavailable' && rulesState !== 'unavailable' ? t('detail.notFound') : t('unavailable')}</Alert>}
      </section>
    );
  }
  if (rulesState === 'failed') {
    return (
      <section className="space-y-4">
        {backList}
        <Alert>{t('noticeFailed')}</Alert>
        <Button variant="ghost" onClick={() => void reload()}>
          {tc('retry')}
        </Button>
      </section>
    );
  }
  if (!report || !rules) return <section className="space-y-4">{backList}</section>;

  const line = (key: TaxLineKey) => report.lines.find((l) => l.key === key);
  const problems = PROBLEM_ORDER.filter((code) => (report.problemCounts[code] ?? 0) > 0);
  const summary: [string, TaxLineKey][] = [
    [t('detail.grossBase'), 'gross_base'],
    [t('detail.incomeTax'), 'income_tax'],
    [t('detail.vat'), 'vat'],
    [t('detail.localTax'), 'local_tax'],
  ];

  async function openPdf() {
    const blob = await action.run(() => apiBlob(`/tax/reports/${reportId}/pdf`));
    if (blob) openBlob(blob, exportFilename(report!.propertyName, report!.month, 'pdf'));
  }
  async function downloadXlsx() {
    const blob = await action.run(() => apiBlob(`/tax/reports/${reportId}/xlsx`));
    if (blob) downloadBlob(blob, exportFilename(report!.propertyName, report!.month, 'xlsx'));
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {backList}
          {manager && (
            <Link href={`/properties/${report.propertyId}/tax`} className="text-sm font-medium text-link hover:underline">
              {t('detail.backProperty')}
            </Link>
          )}
        </div>
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('detail.title', { month: monthLabel(report.month) })}</h1>
        <p className="text-sm text-slate">
          {report.propertyName} · {tp(`taxRegime.${report.regime}`)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={TONE[report.status]}>{t(`status.${report.status}`)}</StatusPill>
          {report.beta && <BetaPill />}
        </div>
      </div>

      <TaxNotice beta={report.beta} rules={rules} />
      {report.status === 'outdated' && <Alert tone="warning">{manager ? t('detail.outdatedManager') : t('detail.outdatedReader')}</Alert>}
      {action.error && <Alert>{action.error}</Alert>}

      <div className="flex flex-wrap gap-2">
        <Button variant="dark" onClick={openPdf} disabled={action.pending}>
          {t('openPdf')}
        </Button>
        <Button variant="ghost" onClick={downloadXlsx} disabled={action.pending}>
          {t('downloadXlsx')}
        </Button>
      </div>
      <p className="-mt-3 text-xs text-slate">{t('exportNotice')}</p>

      <div className="space-y-2">
        <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('detail.summary')}</h2>
        <div className="grid grid-cols-2 gap-3">
          {summary.map(([label, key]) => (
            <Card key={key} className="space-y-1 p-4 sm:p-5">
              <Meta>{label}</Meta>
              <p className="font-display text-xl leading-[1.3] font-bold tracking-[-0.02em] tabular-nums sm:text-2xl">{amount(line(key))}</p>
            </Card>
          ))}
        </div>
      </div>

      <Card className="space-y-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('detail.lines')}</h2>
          <p className="text-sm text-slate">{t('detail.linesHelp')}</p>
        </div>
        <table className="w-full text-sm">
          <thead className="sr-only">
            <tr>
              <th scope="col">{t('detail.colLine')}</th>
              <th scope="col">{t('detail.colAmount')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bone">
            {report.lines.map((l) => {
              const note = noteText(l);
              const strong = HIGHLIGHT.includes(l.key);
              return (
                <tr key={l.key} className={strong ? 'bg-mist' : undefined}>
                  <th scope="row" className={`px-2 py-3 text-start align-top ${strong ? 'font-bold' : 'font-medium'} ${l.info ? 'text-slate' : ''}`}>
                    {t(`line.${l.key}`)}
                    {note && <span className="mt-0.5 block text-xs font-normal text-slate">{note}</span>}
                  </th>
                  <td className={`px-2 py-3 text-end align-top whitespace-nowrap tabular-nums ${strong ? 'font-display text-base font-bold' : ''} ${l.info ? 'text-slate' : ''}`}>{amount(l)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('detail.problems')}</h2>
        {problems.length === 0 ? (
          <p className="text-sm text-slate">{t('detail.noProblems')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {problems.map((code) => (
              <li key={code}>
                <StatusPill tone="warning">
                  {t(`problem.${code}`)} : {report.problemCounts[code]}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
        {manager && problems.length > 0 && (
          <Link href={`/properties/${report.propertyId}/tax`} className="inline-block text-sm font-medium text-link hover:underline">
            {t('detail.fixProblems')}
          </Link>
        )}
      </Card>

      <Card className="space-y-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('detail.rules')}</h2>
          <p className="text-sm text-slate">{t('detail.rulesHelp')}</p>
        </div>
        <ul className="divide-y divide-bone">
          {report.rules.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0 font-mono text-sm break-all">
                <bdi dir="ltr">{r.key}</bdi>
              </span>
              {!r.present ? (
                <StatusPill tone="danger">{t('detail.ruleAbsent')}</StatusPill>
              ) : r.validated ? (
                <StatusPill tone="success">{t('detail.ruleValidated', { date: r.validatedAt ? format.dateTime(new Date(r.validatedAt), { dateStyle: 'medium', timeZone: 'UTC' }) : '' })}</StatusPill>
              ) : (
                <StatusPill tone="warning">{t('detail.ruleUnvalidated')}</StatusPill>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-slate">{t('detail.meta', { date: when(report.generatedAt), template: report.templateVersion, disclaimer: report.disclaimerVersion })}</p>
    </section>
  );
}
