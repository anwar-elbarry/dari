'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, apiBlob } from '../../lib/api';
import { exportFilename } from '../../lib/tax';
import type { TaxMissing, TaxMonths, TaxReportDetail } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { downloadBlob, openBlob } from '../checkin/share';
import { Alert, Button, Card, LinkButton, StatusPill } from '../ui';
import { AmountsDialog, AmountsTarget } from './amounts-dialog';
import { MissingDialog } from './missing-dialog';
import { BetaPill, isBeta, TaxNotice, useTaxRules } from './tax-notice';

const TONE = { none: 'neutral', generated: 'success', outdated: 'warning' } as const;
const total = (counts: Record<string, number | undefined>) => Object.values(counts).reduce<number>((a, n) => a + (n ?? 0), 0);

/**
 * Monthly tax estimates of one property (Owner/Manager). Each month can be generated, opened as PDF, downloaded
 * as Excel and checked for missing data. The disclaimer wording comes from the API; nothing is shown without it.
 */
export function TaxScreen({ propertyId }: { propertyId: string }) {
  const t = useTranslations('tax');
  const tp = useTranslations('properties');
  const format = useFormatter();
  const tc = useTranslations('common');
  const { rules, state: rulesState, reload: reloadRules } = useTaxRules();
  const [data, setData] = useState<TaxMonths | null>(null);
  const [state, setState] = useState<'ok' | 'failed' | 'unavailable'>('ok');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [missing, setMissing] = useState<TaxMissing | null>(null);
  const [known, setKnown] = useState<Record<string, number>>({});
  const [amounts, setAmounts] = useState<AmountsTarget | null>(null);
  const action = useSubmit();

  const load = useCallback(async () => {
    try {
      setData(await api<TaxMonths>('GET', `/properties/${propertyId}/tax-reports`));
      setState('ok');
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? 'unavailable' : 'failed');
    }
  }, [propertyId]);
  useEffect(() => {
    void load();
  }, [load]);

  const label = (month: string) => format.dateTime(new Date(`${month}-01`), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const name = data?.property.name ?? '';

  async function showMissing(month: string) {
    const result = await action.run(() => api<TaxMissing>('GET', `/properties/${propertyId}/tax-reports/${month}/missing`));
    if (!result) return;
    setKnown((k) => ({ ...k, [month]: result.problems.length }));
    setMissing(result);
  }

  async function generate(month: string) {
    setNotice(null);
    setBusy(month);
    const result = await action.run(() => api<TaxReportDetail>('POST', `/properties/${propertyId}/tax-reports/${month}`));
    setBusy(null);
    if (!result) return;
    await load();
    void reloadRules();
    const count = total(result.problemCounts);
    setKnown((k) => ({ ...k, [month]: count }));
    if (count > 0) {
      setNotice(t('generatedWithProblems', { month: label(month), count }));
      await showMissing(month); // shown after generating as well as before
    } else {
      setNotice(t('generated', { month: label(month) }));
    }
  }

  async function openPdf(month: string, reportId: string) {
    const blob = await action.run(() => apiBlob(`/tax/reports/${reportId}/pdf`));
    if (blob) openBlob(blob, exportFilename(name, month, 'pdf'));
  }

  async function downloadXlsx(month: string, reportId: string) {
    const blob = await action.run(() => apiBlob(`/tax/reports/${reportId}/xlsx`));
    if (blob) downloadBlob(blob, exportFilename(name, month, 'xlsx'));
  }

  async function amountsSaved() {
    setAmounts(null);
    setNotice(t('amounts.saved'));
    if (missing) await showMissing(missing.month); // the list shrinks as stays are completed
    await load();
  }

  const anyBeta = !!rules && (isBeta(rules, false) || !!data?.months.some((m) => m.beta));
  const ready = !!rules && !!data;

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link href={`/properties/${propertyId}`} className="text-sm font-medium text-link hover:underline">
          ← {t('back')}
        </Link>
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        <p className="text-sm text-slate">
          {name ? `${name} · ` : ''}
          {t('intro')}
        </p>
      </div>

      {(state === 'unavailable' || rulesState === 'unavailable') && <Alert tone="info">{t('unavailable')}</Alert>}
      {state === 'failed' && <Alert>{t('loadFailed')}</Alert>}
      {rulesState === 'failed' && (
        <Alert>
          {t('noticeFailed')}{' '}
          <button type="button" onClick={() => void reloadRules()} className="font-medium text-link underline">
            {tc('retry')}
          </button>
        </Alert>
      )}
      {rules && <TaxNotice beta={anyBeta} rules={rules} />}

      {ready && (
        <dl className="grid gap-3 rounded-card border border-bone bg-card p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate">{t('regime')}</dt>
            <dd className="font-medium">{tp(`taxRegime.${data.property.regime}`)}</dd>
          </div>
          <div>
            <dt className="text-slate">{t('taxeSejour')}</dt>
            <dd className="font-medium">{tp(`taxeSejourMode.${data.property.taxeSejourMode}`)}</dd>
          </div>
        </dl>
      )}

      {notice && <Alert tone="success">{notice}</Alert>}
      {action.error && <Alert>{action.error}</Alert>}

      {ready && (
        <ul className="space-y-4">
          {data.months.map((m) => {
            const count = known[m.month];
            return (
              <li key={m.month}>
                <Card className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-display text-lg font-semibold capitalize">{label(m.month)}</h2>
                      {m.generatedAt && <p className="text-sm text-slate">{t('generatedOn', { date: when(m.generatedAt) })}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={TONE[m.status]}>{t(`status.${m.status}`)}</StatusPill>
                      {m.beta && <BetaPill />}
                    </div>
                  </div>

                  {count !== undefined && (
                    <p>
                      <StatusPill tone={count > 0 ? 'warning' : 'neutral'}>{count > 0 ? t('missingCount', { count }) : t('nothingMissing')}</StatusPill>
                    </p>
                  )}
                  {m.status === 'outdated' && <p className="text-sm text-slate">{t('outdatedHint')}</p>}

                  <div className="flex flex-wrap gap-2 border-t border-bone pt-3">
                    <Button variant="ghost" onClick={() => showMissing(m.month)} disabled={action.pending}>
                      {t('missingButton')}
                    </Button>
                    <Button variant={m.status === 'none' ? 'primary' : 'ghost'} onClick={() => generate(m.month)} disabled={action.pending}>
                      {busy === m.month ? t('generating') : m.status === 'none' ? t('generate') : t('regenerate')}
                    </Button>
                    {m.reportId && (
                      <>
                        <Button variant="dark" onClick={() => openPdf(m.month, m.reportId!)} disabled={action.pending}>
                          {t('openPdf')}
                        </Button>
                        <Button variant="ghost" onClick={() => downloadXlsx(m.month, m.reportId!)} disabled={action.pending}>
                          {t('downloadXlsx')}
                        </Button>
                        <LinkButton href={`/tax/reports/${m.reportId}`} variant="ghost">
                          {t('details')}
                        </LinkButton>
                      </>
                    )}
                  </div>
                  {m.reportId && <p className="text-xs text-slate">{t('exportNotice')}</p>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <MissingDialog data={missing} month={missing ? label(missing.month) : ''} propertyId={propertyId} onClose={() => setMissing(null)} onEnter={setAmounts} />
      <AmountsDialog target={amounts} onClose={() => setAmounts(null)} onSaved={() => void amountsSaved()} />
    </section>
  );
}
