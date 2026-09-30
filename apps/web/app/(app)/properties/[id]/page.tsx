'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { FeedsPanel } from '../../../../components/property/feeds-panel';
import { ReviewList, StayRow } from '../../../../components/property/stays';
import { NightGauge } from '../../../../components/night-gauge';
import { Require } from '../../../../components/require';
import { Alert, Card, LinkButton, Meta, StatusPill } from '../../../../components/ui';
import { api } from '../../../../lib/api';
import { useSession } from '../../../../lib/session';
import type { DayCounter, PropertyFull, PropertyReduced, Stay } from '../../../../lib/types';
import { useSubmit } from '../../../../lib/use-submit';

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
  const canImport = can('booking:write');

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <Link href="/properties" className="text-sm font-medium text-link hover:underline">
          ← {t('back')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{property.name}</h1>
            <p className="text-sm text-slate">
              {tp(`licenseType.${property.licenseType}`)} · {property.address}, {property.commune}
            </p>
          </div>
          <StatusPill tone={property.licenseStatus === 'LICENSED' ? 'success' : property.licenseStatus === 'PENDING' ? 'neutral' : 'warning'}>{tp(`licenseStatus.${property.licenseStatus}`)}</StatusPill>
        </div>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {decide.error && <Alert>{decide.error}</Alert>}

      <Card className="space-y-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('counter')}</h2>
          <Meta>{td('year', { year: counter.year })}</Meta>
        </div>
        {counter.applies ? (
          <>
            <NightGauge nights={counter.nights} level={counter.level} thresholds={counter.thresholds} label={t('counter')} />
            <p className="text-sm text-slate">{td('ofLimit', { cap: counter.thresholds.cap })}</p>
            {counter.projectedBreachDate && <p className="text-sm text-ink">{td('breach', { date: format.dateTime(new Date(counter.projectedBreachDate), { dateStyle: 'medium', timeZone: 'UTC' }) })}</p>}
            <dl className="grid grid-cols-3 gap-3 border-t border-bone pt-4 text-sm">
              {[
                [t('counted'), counter.nights],
                [t('blocks'), counter.ownerBlockNights],
                [t('uncertain'), counter.uncertainNights],
              ].map(([label, n]) => (
                <div key={label as string}>
                  <dt className="text-slate">{label}</dt>
                  <dd className="font-display text-lg font-semibold tabular-nums">{n}</dd>
                </div>
              ))}
            </dl>
            {!counter.rulesValidated && <Alert tone="warning">{td('rulesNotValidated')}</Alert>}
          </>
        ) : (
          <p className="text-sm text-slate">{td('notApplicable')}</p>
        )}
      </Card>

      {can('booking:write') && <ReviewList stays={uncertain} onDecide={onDecide} busy={decide.pending} />}

      {can('ical:manage') && <FeedsPanel propertyId={id} onChanged={load} />}

      <Card className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('stays')}</h2>
          <div className="flex flex-wrap gap-2">
            {can('checkin:manage') && (
              <LinkButton href={`/properties/${id}/arrivals`} variant="ghost">
                {tci('openArrivals')}
              </LinkButton>
            )}
            {can('checklist:read') && (
              <LinkButton href={`/properties/${id}/checklist`} variant="ghost">
                {tcl('open')}
              </LinkButton>
            )}
            {can('booking:read') && (
              <LinkButton href={`/properties/${id}/registers`} variant="ghost">
                {t('openRegisters')}
              </LinkButton>
            )}
            {can('report:generate') && (
              <LinkButton href={`/properties/${id}/tax`} variant="ghost">
                {t('openTax')}
              </LinkButton>
            )}
            {canImport && (
              <LinkButton href={`/properties/${id}/import`} variant="ghost">
                {t('importTitle')}
              </LinkButton>
            )}
          </div>
        </div>
        {shown.length === 0 ? <p className="text-sm text-slate">{t('noStays')}</p> : <ul className="divide-y divide-bone">{shown.map((s) => <StayRow key={s.id} stay={s} />)}</ul>}
      </Card>
    </section>
  );
}
