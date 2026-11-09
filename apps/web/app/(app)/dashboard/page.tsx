'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { BarChart, Donut } from '../../../components/charts';
import { Rings } from '../../../components/decor';
import { Icon, type IconName } from '../../../components/icons';
import { NightGauge } from '../../../components/night-gauge';
import { Require } from '../../../components/require';
import { Alert, Button, IconChip, KpiTile, LinkButton, Meta, Panel, StatusPill } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import type { Dashboard, Platform } from '../../../lib/types';
import { useSubmit } from '../../../lib/use-submit';

export default function DashboardPage() {
  return (
    <Require capability="booking:read">
      <DashboardView />
    </Require>
  );
}

/** Platform colours: ink, olive, grey, light grey; the legend always carries the name and the figure. */
const PLATFORMS: { key: Platform; stroke: string; fill: string }[] = [
  { key: 'AIRBNB', stroke: 'stroke-ink', fill: 'bg-ink' },
  { key: 'BOOKING', stroke: 'stroke-brand-700', fill: 'bg-brand-700' },
  { key: 'DIRECT', stroke: 'stroke-line-strong', fill: 'bg-line-strong' },
  { key: 'OTHER', stroke: 'stroke-cloud', fill: 'bg-cloud' },
];

function DashboardView() {
  const t = useTranslations('dashboard');
  const tp = useTranslations('properties');
  const tpr = useTranslations('property');
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
  const now = new Date();
  const currentMonth = data.year === now.getFullYear() ? now.getMonth() : null;
  const platformTotal = Object.values(data.activity.nightsBySource).reduce((a, b) => a + b, 0);
  const counted = data.properties.filter((p) => p.counter.applies);
  const nights = counted.reduce((sum, p) => sum + p.counter.nights, 0);
  // Shortcuts are filtered for convenience only; the API enforces every permission.
  const actions = [
    can('team:manage') && { href: '/team', label: t('qaInvite'), icon: 'users' },
    can('share:manage') && { href: '/shares', label: t('qaShares'), icon: 'link' },
    can('report:read') && { href: '/reports', label: t('qaReports'), icon: 'report' },
    can('team:manage') && { href: '/notifications', label: t('qaAlerts'), icon: 'bell' },
  ].filter(Boolean) as { href: string; label: string; icon: IconName }[];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {title}
        <Meta>{t('year', { year: data.year })}</Meta>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {resolve.error && <Alert>{resolve.error}</Alert>}
      {!data.thresholds && !data.rulesValidated && data.properties.length > 0 && <Alert tone="warning">{t('rulesNotValidated')}</Alert>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section className="relative flex flex-col overflow-hidden rounded-card-lg bg-primary p-6 text-on-primary shadow-sm lg:col-span-5">
          <Rings />
          <div className="relative flex flex-1 flex-col">
            <p className="font-display text-sm font-semibold">{t('heroLabel', { year: data.year })}</p>
            <p className="mt-2 font-display text-5xl leading-[1.1] font-bold tracking-[-0.035em] tabular-nums">
              {nights}
              <small className="ms-2 text-xl font-semibold tracking-[-0.02em]">{t('nightsUnit')}</small>
            </p>
            <p className="mt-1 text-sm">{t('heroCaption', { count: counted.length })}</p>
            <div className="mt-auto flex flex-wrap gap-2 pt-6">
              {can('property:write') && (
                <LinkButton href="/properties/new" variant="light">
                  <Icon name="plus" size={18} />
                  {tp('add')}
                </LinkButton>
              )}
              {can('property:read') && (
                <LinkButton href="/properties" variant="dark">
                  {t('seeProperties')}
                  <Icon name="arrowUpRight" size={18} className="rtl:-scale-x-100" />
                </LinkButton>
              )}
            </div>
          </div>
        </section>

        <Panel title={t('overview')} className="lg:col-span-7">
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
            <KpiTile icon={<Icon name="building" />} label={t('properties')} value={data.totals.properties} />
            <KpiTile icon={<Icon name="alert" />} label={t('atRisk')} value={data.totals.atRisk} status={data.totals.atRisk > 0 ? <IconChip tone="warning" className="size-7"><Icon name="alert" size={14} /></IconChip> : undefined} />
            <KpiTile icon={<Icon name="calendar" />} label={t('toReview')} value={data.totals.pendingReview} />
            <KpiTile icon={<Icon name="users" />} label={t('arrivals', { days: data.activity.upcomingDays })} value={data.activity.upcomingArrivals} />
          </div>
        </Panel>

        <Panel title={t('monthlyTitle')} subtitle={t('monthlySubtitle', { year: data.year })} className="lg:col-span-8">
          <BarChart
            caption={t('monthlySubtitle', { year: data.year })}
            header={[t('month'), t('nightsCounted')]}
            highlightNote={currentMonth !== null ? t('currentMonth') : undefined}
            bars={data.activity.nightsByMonth.map((value, i) => {
              const d = new Date(Date.UTC(data.year, i, 1));
              return {
                value,
                label: format.dateTime(d, { month: 'narrow', timeZone: 'UTC' }),
                longLabel: format.dateTime(d, { month: 'long', timeZone: 'UTC' }),
                highlight: i === currentMonth,
              };
            })}
          />
        </Panel>

        <Panel title={t('platformTitle')} subtitle={t('platformSubtitle', { year: data.year })} className="lg:col-span-4">
          <Donut
            center={platformTotal}
            centerLabel={t('platformCenter')}
            formatShare={(f) => format.number(f, { style: 'percent', maximumFractionDigits: 0 })}
            slices={PLATFORMS.map((p) => ({ label: tpr(`source.${p.key}`), value: data.activity.nightsBySource[p.key], stroke: p.stroke, fill: p.fill }))}
          />
        </Panel>

        <Panel title={t('nightsPanel')} subtitle={data.thresholds ? t('ofLimit', { cap: data.thresholds.cap }) : undefined} className="lg:col-span-8">
          {data.properties.length === 0 ? (
            <div className="space-y-3">
              <p className="text-slate">{t('empty')}</p>
              {can('property:write') && <LinkButton href="/properties/new">{tp('add')}</LinkButton>}
            </div>
          ) : (
            <ul className="divide-y divide-bone">
              {data.properties.map((p) => (
                <li key={p.id} className="grid grid-cols-1 gap-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <IconChip>
                        <Icon name="building" size={18} />
                      </IconChip>
                      <div className="min-w-0">
                        <h3 className="line-clamp-2 font-display text-base font-semibold tracking-[-0.01em]">
                          <Link href={`/properties/${p.id}`} className="hover:underline">
                            {p.name}
                          </Link>
                        </h3>
                        <p className="truncate text-sm text-slate">{tp(`licenseType.${p.licenseType}`)}</p>
                      </div>
                    </div>
                    <div className="flex flex-none items-center gap-2">
                      <StatusPill tone={p.licenseStatus === 'LICENSED' ? 'success' : p.licenseStatus === 'PENDING' ? 'neutral' : 'warning'}>{tp(`licenseStatus.${p.licenseStatus}`)}</StatusPill>
                      <Link href={`/properties/${p.id}`} aria-label={`${t('open')} — ${p.name}`} className="inline-flex size-11 items-center justify-center rounded-pill border border-bone bg-card text-ink hover:bg-mercury">
                        <Icon name="arrowUpRight" size={18} className="rtl:-scale-x-100" />
                      </Link>
                    </div>
                  </div>
                  {p.counter.applies && data.thresholds ? (
                    <NightGauge nights={p.counter.nights} level={p.counter.level} thresholds={data.thresholds} label={`${p.name} — ${t('nightsCounted')}`} />
                  ) : (
                    <p className="text-sm text-slate">{t('notApplicable')}</p>
                  )}
                  {(p.counter.pendingReview > 0 || (p.feedProblems ?? 0) > 0 || (p.counter.projectedBreachDate && data.thresholds)) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {p.counter.pendingReview > 0 && <StatusPill tone="warning">{t('reviewCount', { count: p.counter.pendingReview })}</StatusPill>}
                      {(p.feedProblems ?? 0) > 0 && <StatusPill tone="danger">{t('feedProblems', { count: p.feedProblems! })}</StatusPill>}
                      {p.counter.projectedBreachDate && data.thresholds && (
                        <p className="text-sm text-slate">{t('breach', { date: format.dateTime(new Date(p.counter.projectedBreachDate), { dateStyle: 'medium', timeZone: 'UTC' }) })}</p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="grid content-start gap-5 lg:col-span-4">
          {data.thresholds && (
            <Panel title={t('rulesTitle')} action={<StatusPill tone={data.rulesValidated ? 'success' : 'warning'}>{t(data.rulesValidated ? 'rulesConfirmed' : 'rulesToConfirm')}</StatusPill>}>
              <ul className="space-y-2 text-sm text-carbon">
                <li className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full bg-warning" />{t('rulesAmber', { count: data.thresholds.amber })}</li>
                <li className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full bg-danger" />{t('rulesRed', { count: data.thresholds.red })}</li>
                <li className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full bg-ink" />{t('rulesCap', { count: data.thresholds.cap })}</li>
              </ul>
              <p className="mt-4 text-xs text-slate">{t(data.rulesValidated ? 'rulesValidated' : 'rulesNotValidated')}</p>
            </Panel>
          )}

          {actions.length > 0 && (
            <Panel title={t('quickActions')}>
              <ul className="grid grid-cols-2 gap-3">
                {actions.map((a) => (
                  <li key={a.href}>
                    <Link href={a.href} className="flex h-full min-h-24 flex-col items-center justify-center gap-2 rounded-card border border-bone bg-mist p-3 text-center font-display text-sm font-semibold text-ink no-underline hover:bg-mercury">
                      <IconChip tone="raised">
                        <Icon name={a.icon} size={18} />
                      </IconChip>
                      {a.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <Panel title={t('alerts')} className="lg:col-span-12">
          {data.alerts.length === 0 ? (
            <p className="text-sm text-slate">{t('noAlerts')}</p>
          ) : (
            <ul className="divide-y divide-bone">
              {data.alerts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-start gap-3">
                    <IconChip tone={a.severity === 'RED' ? 'danger' : 'warning'}>
                      <Icon name="alert" size={18} />
                    </IconChip>
                    <div className="min-w-0 space-y-1">
                      <StatusPill tone={a.severity === 'RED' ? 'danger' : 'warning'}>{t(`severity.${a.severity}`)}</StatusPill>
                      <p className="text-sm text-ink">{a.message}</p>
                      <p className="text-xs text-slate">{format.dateTime(new Date(a.createdAt), { dateStyle: 'medium' })}</p>
                    </div>
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
        </Panel>
      </div>
    </section>
  );
}
