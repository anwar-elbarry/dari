'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Require } from '../../../components/require';
import Link from 'next/link';
import { Alert, Card, LinkButton, StatusPill } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import type { LicenseStatus, PropertyFull, PropertyReduced } from '../../../lib/types';

const LICENSE_TONE: Record<LicenseStatus, 'success' | 'warning' | 'neutral'> = { LICENSED: 'success', PENDING: 'neutral', UNLICENSED: 'warning' };

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
  const [error, setError] = useState(false);
  const canWrite = can('property:write');

  useEffect(() => {
    api<(PropertyReduced | PropertyFull)[]>('GET', '/properties')
      .then(setItems)
      .catch(() => setError(true));
  }, []);

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        {canWrite && (
          <LinkButton href="/properties/new">{t('add')}</LinkButton>
        )}
      </div>
      {error && <Alert>{te('generic')}</Alert>}
      {items?.length === 0 && <Alert tone="info">{canWrite ? t('empty') : t('emptyStaff')}</Alert>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {items?.map((p) => (
          <li key={p.id}>
            <Card className="h-full space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">
                  <Link href={`/properties/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>
                </h2>
                <StatusPill tone={LICENSE_TONE[p.licenseStatus]}>{t(`licenseStatus.${p.licenseStatus}`)}</StatusPill>
              </div>
              <p className="text-sm text-slate">{t(`licenseType.${p.licenseType}`)}</p>
              <p className="text-sm text-slate">
                {p.address}, {p.commune}
              </p>
              {'owner' in p && (
                <p className="text-sm text-slate">
                  {t('owner')} : {p.owner.name}
                </p>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
