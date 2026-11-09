'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSession } from '../../lib/session';
import type { LicenseType, PropertyFull, PropertyReduced } from '../../lib/types';
import { Icon, type IconName } from '../icons';
import { StatusPill } from '../ui';

const TYPE_ICON: Record<LicenseType, IconName> = { FURNISHED_APARTMENT: 'apartment', RIAD: 'riad', MAISON_DHOTE: 'house', AUBERGE: 'bed' };

/**
 * Header of every property screen: breadcrumb, identity card and the section tabs. On the overview the name is the
 * page's h1; on a section page the section title is, so the name is plain text there.
 */
export function PropertyHeader({ property }: { property: PropertyReduced | PropertyFull }) {
  const t = useTranslations('property');
  const tp = useTranslations('properties');
  const tci = useTranslations('checkin');
  const tcl = useTranslations('checklist');
  const pathname = usePathname();
  const { can } = useSession();
  const base = `/properties/${property.id}`;
  const overview = pathname === base;

  // Sections are filtered for convenience only; the API enforces every permission.
  const sections = [
    { href: base, label: t('overview'), icon: 'home' },
    can('checkin:manage') && { href: `${base}/arrivals`, label: tci('openArrivals'), icon: 'users' },
    can('booking:read') && { href: `${base}/registers`, label: t('openRegisters'), icon: 'clipboard' },
    can('report:generate') && { href: `${base}/tax`, label: t('openTax'), icon: 'report' },
    can('checklist:read') && { href: `${base}/checklist`, label: tcl('open'), icon: 'shield' },
    can('booking:write') && { href: `${base}/import`, label: t('importTitle'), icon: 'upload' },
  ].filter(Boolean) as { href: string; label: string; icon: IconName }[];

  const nameClass = 'font-display leading-[1.25] font-bold tracking-[-0.02em]';
  return (
    <div className="space-y-5">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Link href="/properties" className="font-medium text-link hover:underline">
          {t('back')}
        </Link>
        <span aria-hidden className="text-ash">/</span>
        {overview ? (
          <span className="truncate text-slate">{property.name}</span>
        ) : (
          <Link href={base} className="truncate font-medium text-link hover:underline">
            {property.name}
          </Link>
        )}
      </div>

      <header className="rounded-card-lg border border-bone bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <span aria-hidden className={`inline-flex flex-none items-center justify-center rounded-card-lg bg-night text-brand-500 ${overview ? 'size-14' : 'size-11'}`}>
              <Icon name={TYPE_ICON[property.licenseType]} size={overview ? 26 : 22} />
            </span>
            <div className="min-w-0 space-y-1.5">
              {overview ? <h1 className={`${nameClass} text-2xl sm:text-3xl`}>{property.name}</h1> : <p className={`${nameClass} text-xl`}>{property.name}</p>}
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
            const current = pathname === s.href;
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
    </div>
  );
}
