'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Icon, type IconName } from '../../../../components/icons';
import { NightGauge } from '../../../../components/night-gauge';
import { FeedsPanel } from '../../../../components/property/feeds-panel';
import { ReviewList, StayRow } from '../../../../components/property/stays';
import { Require } from '../../../../components/require';
import { Alert, IconChip, KpiTile, Meta, Panel, StatusPill } from '../../../../components/ui';
import { api } from '../../../../lib/api';
import { useSession } from '../../../../lib/session';
import type { DayCounter, LicenseType, PropertyFull, PropertyReduced, Stay } from '../../../../lib/types';
import { useSubmit } from '../../../../lib/use-submit';

const TYPE_ICON: Record<LicenseType, IconName> = { FURNISHED_APARTMENT: 'apartment', RIAD: 'riad', MAISON_DHOTE: 'house', AUBERGE: 'bed' };

export default function PropertyDetailPage() {
  return (
    <Require capability="property:read">
      <Detail />
    </Require>
  );
}

function Detail() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('property');
  const td = useTranslations('dashboard');
  const tp = useTranslations('properties');
  const tw = useTranslations('wizard');
  const te = useTranslations('errors');
  const tci = useTranslations('checkin');
  const tcl = useTranslations('checklist');
  const format = useFormatter();
  const { can } = useSession();
  const [property, setProperty] = useState<PropertyReduced | PropertyFull | null>(null);
  const [counter, setCounter] = useState<DayCounter | null>(null);
  const [stays, setStays] = useState<Stay[]>([]);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const decide = useSubmit();

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api<PropertyReduced | PropertyFull>('GET', `/properties/${id}`), api<DayCounter>('GET', `/properties/${id}/day-counter`)]);
      setProperty(p);
      setCounter(c);
      setStays(await api<Stay[]>('GET', `/properties/${id}/bookings?from=${c.year}-01-01`));
    } catch {
      setFailed(true);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function onDecide(stayId: string, classification: 'BOOKING' | 'OWNER_BLOCK') {
    setNotice(null);
    if (await decide.run(() => api('PATCH', `/bookings/${stayId}/classification`, { classification }).then(() => true))) {
      setNotice(t('classified'));
      await load();
    }
  }

  if (failed) return <Alert>{te('generic')}</Alert>;
  if (!property || !counter) return null;

  const uncertain = stays.filter((s) => s.classification === 'UNCERTAIN' && s.status === 'CONFIRMED');
  const shown = stays.filter((s) => !uncertain.includes(s)).sort((a, b) => b.checkIn.localeCompare(a.checkIn));
  const full = 'owner' in property ? property : null;

  // Sections are filtered for convenience only; the API enforces every permission.
  const sections = [
    { href: `/properties/${id}`, label: t('overview'), icon: 'home' },
    can('checkin:manage') && { href: `/properties/${id}/arrivals`, label: tci('openArrivals'), icon: 'users' },
    can('booking:read') && { href: `/properties/${id}/registers`, label: t('openRegisters'), icon: 'clipboard' },
    can('report:generate') && { href: `/properties/${id}/tax`, label: t('openTax'), icon: 'report' },
    can('checklist:read') && { href: `/properties/${id}/checklist`, label: tcl('open'), icon: 'shield' },
    can('booking:write') && { href: `/properties/${id}/import`, label: t('importTitle'), icon: 'upload' },
  ].filter(Boolean) as { href: string; label: string; icon: IconName }[];

  const details = [
    { label: tw('licenseType'), value: tp(`licenseType.${property.licenseType}`) },
    { label: tw('commune'), value: property.commune },
    full && { label: tp('owner'), value: `${full.owner.name} · ${tp(`residency.${full.owner.residency}`)}` },
    full && { label: tw('taxRegime'), value: tp(`taxRegime.${full.taxRegime}`) },
    full && { label: tw('taxeSejourMode'), value: tp(`taxeSejourMode.${full.taxeSejourMode}`) },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/properties" className="font-medium text-link hover:underline">
          {t('back')}
        </Link>
        <span aria-hidden className="text-ash">/</span>
        <span className="truncate text-slate">{property.name}</span>
      </div>

      <header className="rounded-card-lg border border-bone bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <span aria-hidden className="inline-flex size-14 flex-none items-center justify-center rounded-card-lg bg-night text-brand-500">
              <Icon name={TYPE_ICON[property.licenseType]} size={26} />
            </span>
            <div className="min-w-0 space-y-1.5">
              <h1 className="font-display text-2xl leading-[1.25] font-bold tracking-[-0.02em] sm:text-3xl">{property.name}</h1>
              <p className="flex items-start gap-1.5 text-sm text-slate">
                <Icon name="pin" size={16} className="mt-0.5 flex-none" />
                <span>
                  {property.address}, {property.commune}
                </span>
              </p>
            </div>
          </div>
          <StatusPill tone={property.licenseStatus === 'LICENSED' ? 'success' : property.licenseStatus === 'PENDING' ? 'neutral' : 'warning'}>{tp(`licenseStatus.${property.licenseStatus}`)}</StatusPill>
        </div>

        <nav aria-label={t('sections')} className="-mx-1 mt-5 flex gap-2 overflow-x-auto border-t border-bone px-1 pt-4 md:flex-wrap md:overflow-visible">
          {sections.map((s) => {
            const current = s.href === `/properties/${id}`;
            return (
              <Link
                key={s.href}
                href={s.href}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex min-h-11 flex-none items-center gap-2 rounded-pill border px-4 font-display text-sm font-semibold whitespace-nowrap no-underline ${current ? 'border-brand-100 bg-brand-50 text-link' : 'border-bone bg-card text-carbon hover:bg-mercury'}`}
              >
                <Icon name={s.icon} size={18} />
                {s.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {notice && <Alert tone="success">{notice}</Alert>}
      {decide.error && <Alert>{decide.error}</Alert>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Panel title={t('counter')} action={<Meta>{td('year', { year: counter.year })}</Meta>} className="lg:col-span-7">
          {counter.applies ? (
            <div className="space-y-4">
              <NightGauge nights={counter.nights} level={counter.level} thresholds={counter.thresholds} label={t('counter')} />
              <p className="text-sm text-slate">{td('ofLimit', { cap: counter.thresholds.cap })}</p>
              {counter.projectedBreachDate && (
                <p className="flex items-start gap-2 text-sm text-ink">
                  <Icon name="calendar" size={16} className="mt-0.5 flex-none text-slate" />
                  {td('breach', { date: format.dateTime(new Date(counter.projectedBreachDate), { dateStyle: 'medium', timeZone: 'UTC' }) })}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {(
                  [
                    [t('counted'), counter.nights, 'moon'],
                    [t('blocks'), counter.ownerBlockNights, 'house'],
                    [t('uncertain'), counter.uncertainNights, 'alert'],
                  ] as const
                ).map(([label, n, icon]) => (
                  <KpiTile key={label} icon={<Icon name={icon} size={18} />} label={label} value={n} />
                ))}
              </div>
              {!counter.rulesValidated && <Alert tone="warning">{td('rulesNotValidated')}</Alert>}
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-card border border-bone bg-mist p-4">
              <IconChip tone="raised">
                <Icon name="shield" size={18} />
              </IconChip>
              <p className="pt-2 text-sm text-carbon">{td('notApplicable')}</p>
            </div>
          )}
        </Panel>

        <Panel title={t('details')} className="lg:col-span-5">
          <dl className="divide-y divide-bone">
            {details.map((d) => (
              <div key={d.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                <dt className="text-sm text-slate">{d.label}</dt>
                <dd className="text-sm font-medium text-ink">{d.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        {can('booking:write') && uncertain.length > 0 && (
          <div className="lg:col-span-12">
            <ReviewList stays={uncertain} onDecide={onDecide} busy={decide.pending} />
          </div>
        )}

        <Panel title={t('stays')} subtitle={t('staysCount', { count: shown.length, year: counter.year })} className={can('ical:manage') ? 'lg:col-span-7' : 'lg:col-span-12'}>
          {shown.length === 0 ? <p className="text-sm text-slate">{t('noStays')}</p> : <ul className="divide-y divide-bone">{shown.map((s) => <StayRow key={s.id} stay={s} />)}</ul>}
        </Panel>

        {can('ical:manage') && (
          <div className="lg:col-span-5">
            <FeedsPanel propertyId={id} onChanged={load} />
          </div>
        )}
      </div>
    </section>
  );
}
