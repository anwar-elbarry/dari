'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, apiBlob } from '../../lib/api';
import { useSession } from '../../lib/session';
import type { GeneratedRegister, PropertyReduced, RegisterMonth, RegisterStatus, ShareTarget, ValidationReport } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { GuestDialog } from '../checkin/guest-dialog';
import { openBlob } from '../checkin/share';
import { ShareDialog } from '../share/share-dialog';
import { Alert, Button, Card, StatusPill } from '../ui';
import { ValidationDialog } from './validation-dialog';

const TONE: Record<RegisterStatus, 'neutral' | 'success' | 'warning'> = { none: 'neutral', generated: 'success', outdated: 'warning' };

/**
 * Registers of a property, month by month. Owner/Manager see the counts of incomplete records (before and
 * after generating), generate, open the PDF and share; Staff see the status only. The API decides what each
 * role gets: hiding buttons here is convenience.
 */
export function RegistersScreen({ propertyId }: { propertyId: string }) {
  const t = useTranslations('register');
  const format = useFormatter();
  const { can } = useSession();
  const [property, setProperty] = useState<PropertyReduced | null>(null);
  const [months, setMonths] = useState<RegisterMonth[] | null>(null);
  const [state, setState] = useState<'ok' | 'failed' | 'unavailable'>('ok');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{ month: string; data: ValidationReport } | null>(null);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [shareMonth, setShareMonth] = useState<string | null>(null);
  const action = useSubmit();
  const manager = can('register:read');

  const load = useCallback(async () => {
    try {
      const [p, list] = await Promise.all([api<PropertyReduced>('GET', `/properties/${propertyId}`), api<{ months: RegisterMonth[] }>('GET', `/properties/${propertyId}/registers`)]);
      setProperty(p);
      setMonths(list.months);
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

  async function showReport(month: string) {
    const data = await action.run(() => api<ValidationReport>('GET', `/properties/${propertyId}/registers/${month}/validation`));
    if (data) setReport({ month, data });
  }

  async function generate(month: string) {
    setNotice(null);
    setBusy(month);
    const result = await action.run(() => api<GeneratedRegister>('POST', `/properties/${propertyId}/registers/${month}`));
    setBusy(null);
    if (!result) return;
    await load();
    // A link gives the version that was shared: regenerating revokes the links to the previous one.
    const revoked = result.revokedShares > 0 ? ` ${t('sharesRevoked', { count: result.revokedShares })}` : '';
    if (result.summary.problems > 0) {
      setNotice(t('generatedWithProblems', { month: label(month), count: result.summary.problems }) + revoked);
      await showReport(month); // the report is shown after generating as well as before
    } else {
      setNotice(t('generated', { month: label(month) }) + revoked);
    }
  }

  async function openPdf(month: string) {
    const blob = await action.run(() => apiBlob(`/properties/${propertyId}/registers/${month}/pdf`));
    if (blob) openBlob(blob, `registre-${month}.pdf`);
  }

  const target: ShareTarget | null = shareMonth ? { type: 'POLICE_REGISTER', propertyId, month: shareMonth } : null;

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link href={`/properties/${propertyId}`} className="text-sm font-medium text-link hover:underline">
          ← {t('back')}
        </Link>
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        <p className="text-sm text-slate">{property ? `${property.name} · ` : ''}{t('intro')}</p>
        {!manager && <Alert tone="info">{t('staffNote')}</Alert>}
        {manager && (
          <p className="text-sm text-slate">
            {t('layoutNote')} {t('monthRule')}
          </p>
        )}
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {action.error && <Alert>{action.error}</Alert>}
      {state === 'failed' && <Alert>{t('loadFailed')}</Alert>}
      {state === 'unavailable' && <Alert tone="info">{t('unavailable')}</Alert>}
      {months && months.length === 0 && <p className="text-sm text-slate">{t('empty')}</p>}

      <ul className="space-y-4">
        {months?.map((m) => {
          const problems = m.problems ?? 0;
          return (
            <li key={m.month}>
              <Card className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-semibold capitalize">{label(m.month)}</h2>
                    {manager && m.guests !== undefined && m.stays !== undefined && <p className="text-sm text-slate">{t('counts', { guests: m.guests, stays: m.stays })}</p>}
                    {manager && m.generatedAt && <p className="text-sm text-slate">{t('generatedOn', { date: when(m.generatedAt) })}</p>}
                  </div>
                  <StatusPill tone={TONE[m.status]}>{t(`status.${m.status}`)}</StatusPill>
                </div>

                {manager && m.problems !== undefined && (
                  <p className="text-sm">
                    <StatusPill tone={problems > 0 ? 'warning' : 'neutral'}>{problems > 0 ? t('problems', { count: problems }) : t('noProblem')}</StatusPill>
                  </p>
                )}
                {manager && m.status === 'outdated' && <p className="text-sm text-slate">{t('outdatedHint')}</p>}

                {manager && (
                  <div className="flex flex-wrap gap-2 border-t border-bone pt-3">
                    {problems > 0 && (
                      <Button variant="ghost" onClick={() => showReport(m.month)} disabled={action.pending}>
                        {t('report')}
                      </Button>
                    )}
                    <Button variant={m.status === 'none' ? 'primary' : 'ghost'} onClick={() => generate(m.month)} disabled={action.pending}>
                      {busy === m.month ? t('generating') : m.status === 'none' ? t('generate') : t('regenerate')}
                    </Button>
                    {m.status !== 'none' && (
                      <Button variant="dark" onClick={() => openPdf(m.month)} disabled={action.pending}>
                        {t('openPdf')}
                      </Button>
                    )}
                    {can('share:manage') && m.status === 'generated' && (
                      <Button variant="ghost" onClick={() => setShareMonth(m.month)}>
                        {t('share')}
                      </Button>
                    )}
                  </div>
                )}
                {manager && m.status === 'outdated' && can('share:manage') && <p className="text-xs text-slate">{t('shareBlocked')}</p>}
                {manager && m.status !== 'none' && <p className="text-xs text-slate">{t('pdfNotice')}</p>}
              </Card>
            </li>
          );
        })}
      </ul>

      <ValidationDialog report={report?.data ?? null} month={report ? label(report.month) : ''} onClose={() => setReport(null)} onOpenGuest={(id) => setGuestId(id)} />
      <GuestDialog guestId={guestId} onClose={() => setGuestId(null)} onChanged={() => void load()} />
      <ShareDialog target={target} title={t('shareTitle', { month: shareMonth ? label(shareMonth) : '' })} onClose={() => setShareMonth(null)} />
    </section>
  );
}
