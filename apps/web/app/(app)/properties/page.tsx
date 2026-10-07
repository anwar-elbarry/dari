'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Icon } from '../../../components/icons';
import { PropertyCard, PropertyCardSkeleton } from '../../../components/property/property-card';
import { Require } from '../../../components/require';
import { Alert, LinkButton, Meta } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import type { Dashboard, LicenseStatus, PropertyFull, PropertyReduced } from '../../../lib/types';

const FILTERS = ['all', 'LICENSED', 'UNLICENSED', 'PENDING'] as const;
type Filter = (typeof FILTERS)[number];

export default function PropertiesPage() {
  return (
    <Require capability="property:read">
      <Properties />
    </Require>
  );
}

function Properties() {
  const t = useTranslations('properties');
  const te = useTranslations('errors');
  const { can } = useSession();
  const [items, setItems] = useState<(PropertyReduced | PropertyFull)[] | null>(null);
  const [counters, setCounters] = useState<Dashboard | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const canWrite = can('property:write');
  const canCount = can('booking:read');

  useEffect(() => {
    api<(PropertyReduced | PropertyFull)[]>('GET', '/properties')
      .then(setItems)
      .catch(() => setError(true));
    // Night counters live on the dashboard endpoint; the cards simply show less without them.
    if (canCount) api<Dashboard>('GET', '/dashboard').then(setCounters).catch(() => undefined);
  }, [canCount]);

  const count = (f: Filter) => (items ?? []).filter((p) => f === 'all' || p.licenseStatus === f).length;
  const shown = (items ?? []).filter((p) => filter === 'all' || p.licenseStatus === (filter as LicenseStatus));
  const counterOf = (id: string) => counters?.properties.find((c) => c.id === id);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          {items && <Meta>{t('portfolio', { count: items.length })}</Meta>}
          <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        </div>
        {canWrite && (
          <LinkButton href="/properties/new">
            <Icon name="plus" size={18} />
            {t('add')}
          </LinkButton>
        )}
      </div>

      {error && <Alert>{te('generic')}</Alert>}
      {items?.length === 0 && <Alert tone="info">{canWrite ? t('empty') : t('emptyStaff')}</Alert>}

      {items && items.length > 0 && (
        <div role="group" aria-label={t('filterLabel')} className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const on = f === filter;
            return (
              <button
                key={f}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(f)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 font-display text-sm font-bold ${on ? 'border-brand-100 bg-brand-50 text-link' : 'border-bone bg-card text-ink hover:bg-mercury'}`}
              >
                {f === 'all' ? t('filterAll') : t(`filter.${f}`)}
                <span className={`min-w-5 rounded-pill px-1.5 font-sans text-xs leading-5 font-semibold tabular-nums ${on ? 'bg-brand-100' : 'bg-mercury'}`}>{count(f)}</span>
              </button>
            );
          })}
        </div>
      )}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4">
        {items === null && !error && [0, 1, 2].map((i) => <li key={i} className="min-w-0"><PropertyCardSkeleton /></li>)}
        {shown.map((p) => (
          <li key={p.id} className="min-w-0">
            <PropertyCard property={p} counter={counterOf(p.id)} thresholds={counters?.thresholds ?? null} year={counters?.year} />
          </li>
        ))}
        {canWrite && items && items.length > 0 && (
          <li className="min-w-0">
            <Link
              href="/properties/new"
              className="flex h-full min-h-48 flex-col items-center justify-center gap-3 rounded-card border-[1.5px] border-dashed border-cloud p-6 text-center text-ink no-underline transition-colors duration-150 hover:border-line-strong hover:bg-card sm:min-h-[348px]"
            >
              <span aria-hidden className="inline-flex size-12 items-center justify-center rounded-pill bg-mercury">
                <Icon name="plus" size={22} />
              </span>
              <span className="font-display text-base font-bold tracking-[-0.02em]">{t('add')}</span>
              <span className="max-w-60 text-sm text-slate">{t('addHint')}</span>
            </Link>
          </li>
        )}
      </ul>

      {items && items.length > 0 && shown.length === 0 && <p className="text-sm text-slate">{t('noneWithStatus')}</p>}
    </section>
  );
}
