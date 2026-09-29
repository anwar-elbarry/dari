'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { NightGauge } from '../../../components/night-gauge';
import { Require } from '../../../components/require';
import { Alert, Button, Card, LinkButton, Meta, StatCard, StatusPill } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import type { Dashboard } from '../../../lib/types';
import { useSubmit } from '../../../lib/use-submit';

export default function DashboardPage() {
  return (
    <Require capability="booking:read">
      <DashboardView />
    </Require>
  );
}

function DashboardView() {
  const t = useTranslations('dashboard');
  const tp = useTranslations('properties');
  const te = useTranslations('errors');
  const format = useFormatter();
  const { can } = useSession();
  const [data, setData] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const resolve = useSubmit();

  const load = useCallback(() => api<Dashboard>('GET', '/dashboard').then(setData).catch(() => setFailed(true)), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function onResolve(id: string) {
    setNotice(null);
    if ((await resolve.run(() => api('PATCH', `/alerts/${id}`).then(() => true))) === true) {
      setNotice(t('resolved'));
      await load();
    }
  }

  const title = <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>;
  if (failed) return <section className="space-y-4">{title}<Alert>{te('generic')}</Alert></section>;
  if (!data) return <section className="space-y-4">{title}</section>;

  const canResolve = can('alert:resolve');
  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {title}
        <Meta>{t('year', { year: data.year })}</Meta>
      </div>

      {data.properties.length === 0 ? (
        <Card className="space-y-3">
          <p className="text-slate">{t('empty')}</p>
          {can('property:write') && <LinkButton href="/properties/new">{tp('add')}</LinkButton>}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={t('properties')} value={data.totals.properties} />
            <StatCard label={t('atRisk')} value={data.totals.atRisk} />
            <StatCard label={t('toReview')} value={data.totals.pendingReview} />
          </div>
          {!data.rulesValidated && <Alert tone="warning">{t('rulesNotValidated')}</Alert>}
        </>
      )}

      {notice && <Alert tone="success">{notice}</Alert>}
      {resolve.error && <Alert>{resolve.error}</Alert>}
      <div className="space-y-3">
        <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('alerts')}</h2>
        {data.alerts.length === 0 ? (
          <p className="text-sm text-slate">{t('noAlerts')}</p>
        ) : (
          <ul className="grid gap-3">
            {data.alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-bone bg-card p-4">
                <div className="min-w-0 space-y-1">
                  <StatusPill tone={a.severity === 'RED' ? 'danger' : 'warning'}>{t(`severity.${a.severity}`)}</StatusPill>
                  <p className="text-sm text-ink">{a.message}</p>
                  <p className="text-xs text-slate">{format.dateTime(new Date(a.createdAt), { dateStyle: 'medium' })}</p>
                </div>
                {canResolve && (
                  <Button variant="ghost" onClick={() => onResolve(a.id)} disabled={resolve.pending}>
                    {t('resolve')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.properties.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('properties')}</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {data.properties.map((p) => (
              <li key={p.id}>
                <Card className="flex h-full flex-col gap-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-lg font-semibold tracking-[-0.02em]">
                        <Link href={`/properties/${p.id}`} className="hover:underline">
                          {p.name}
                        </Link>
                      </h3>
                      <p className="text-sm text-slate">{tp(`licenseType.${p.licenseType}`)}</p>
                    </div>
                    <StatusPill tone={p.licenseStatus === 'LICENSED' ? 'success' : p.licenseStatus === 'PENDING' ? 'neutral' : 'warning'}>{tp(`licenseStatus.${p.licenseStatus}`)}</StatusPill>
                  </div>
                  {p.counter.applies && data.thresholds ? (
                    <NightGauge nights={p.counter.nights} level={p.counter.level} thresholds={data.thresholds} label={`${p.name} — ${t('nightsCounted')}`} />
                  ) : (
                    <p className="text-sm text-slate">{t('notApplicable')}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {p.counter.pendingReview > 0 && <StatusPill tone="warning">{t('reviewCount', { count: p.counter.pendingReview })}</StatusPill>}
                    {(p.feedProblems ?? 0) > 0 && <StatusPill tone="danger">{t('feedProblems', { count: p.feedProblems! })}</StatusPill>}
                  </div>
                  {p.counter.projectedBreachDate && data.thresholds && (
                    <p className="text-sm text-slate">{t('breach', { date: format.dateTime(new Date(p.counter.projectedBreachDate), { dateStyle: 'medium', timeZone: 'UTC' }) })}</p>
                  )}
                  <div className="mt-auto">
                    <LinkButton href={`/properties/${p.id}`} variant="ghost">
                      {t('open')}
                    </LinkButton>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
