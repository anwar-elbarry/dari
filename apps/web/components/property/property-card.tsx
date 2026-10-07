import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { DashboardProperty, LicenseStatus, LicenseType, PropertyFull, PropertyReduced } from '../../lib/types';
import { Icon, type IconName } from '../icons';
import { Meta, StatusPill } from '../ui';

const LICENSE_TONE: Record<LicenseStatus, 'success' | 'warning' | 'neutral'> = { LICENSED: 'success', PENDING: 'neutral', UNLICENSED: 'warning' };
const TYPE_ICON: Record<LicenseType, IconName> = { FURNISHED_APARTMENT: 'apartment', RIAD: 'riad', MAISON_DHOTE: 'house', AUBERGE: 'bed' };
const BAR = { green: 'bg-ink', amber: 'bg-warning', red: 'bg-danger' } as const;

const sectionClass = 'border-t border-bone px-6';

/**
 * One property in the portfolio grid (design: canvas "Cartes Biens — Dari"). The whole card is one link, made by
 * stretching the name's link over it; nothing else inside is interactive. The counter comes from GET /dashboard,
 * thresholds and cap included: none are decided here.
 */
export function PropertyCard({ property: p, counter, thresholds, year }: { property: PropertyReduced | PropertyFull; counter?: DashboardProperty; thresholds: { amber: number; red: number; cap: number } | null; year?: number }) {
  const t = useTranslations('properties');
  const td = useTranslations('dashboard');
  const c = counter?.counter;
  const flags = [
    c && c.pendingReview > 0 && { tone: 'warning' as const, label: td('reviewCount', { count: c.pendingReview }) },
    (counter?.feedProblems ?? 0) > 0 && { tone: 'danger' as const, label: td('feedProblems', { count: counter!.feedProblems! }) },
  ].filter(Boolean) as { tone: 'warning' | 'danger'; label: string }[];

  return (
    <article className="group relative flex h-full flex-col rounded-card border border-bone bg-card transition-[border-color,box-shadow] duration-150 hover:border-cloud hover:shadow-sm has-[.stretch:focus-visible]:outline-2 has-[.stretch:focus-visible]:outline-offset-2 has-[.stretch:focus-visible]:outline-focus">
      <div className="flex items-start gap-3.5 px-6 pt-6 pb-5">
        <span aria-hidden className="inline-flex size-11 flex-none items-center justify-center rounded-card border border-bone bg-mist text-ink">
          <Icon name={TYPE_ICON[p.licenseType]} size={22} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="line-clamp-2 font-display text-lg leading-[1.35] font-bold tracking-[-0.02em]">
            <Link href={`/properties/${p.id}`} className="stretch text-ink no-underline after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none">
              {p.name}
            </Link>
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusPill tone={LICENSE_TONE[p.licenseStatus]}>{t(`licenseStatus.${p.licenseStatus}`)}</StatusPill>
            <Meta>{t(`licenseType.${p.licenseType}`)}</Meta>
          </div>
        </div>
      </div>

      <dl className={`${sectionClass} flex flex-col gap-2.5 py-4`}>
        <div className="flex items-start gap-2.5">
          <dt className="flex-none pt-px text-slate">
            <Icon name="pin" size={18} />
            <span className="sr-only">{t('address')}</span>
          </dt>
          <dd className="min-w-0 text-sm text-carbon">
            {p.address}, {p.commune}
          </dd>
        </div>
        {'owner' in p && (
          <div className="flex items-start gap-2.5">
            <dt className="flex-none pt-px text-slate">
              <Icon name="user" size={18} />
              <span className="sr-only">{t('owner')}</span>
            </dt>
            <dd className="min-w-0 text-sm text-carbon">
              {p.owner.name} <span className="text-slate">· {t('owner')}</span>
            </dd>
          </div>
        )}
      </dl>

      {c &&
        (c.applies ? (
          <div className={`${sectionClass} flex flex-col gap-2 pt-4 pb-5`}>
            <div className="flex min-h-6 items-center justify-between gap-2">
              <Meta>{t('nightsLabel', { year: year ?? '' })}</Meta>
              {c.level !== 'green' && <StatusPill tone={c.level === 'red' ? 'danger' : 'warning'}>{td(`levels.${c.level}`)}</StatusPill>}
            </div>
            <p className="flex items-baseline gap-1.5">
              <span className="font-display text-[28px] leading-[1.15] font-bold tracking-[-0.03em] tabular-nums">{c.nights}</span>
              <span className="text-sm text-slate">{td('nightsUnit')}</span>
            </p>
            {thresholds && (
              <>
                <div aria-hidden className="h-1.5 overflow-hidden rounded-pill bg-mercury">
                  <div className={`h-full rounded-pill ${BAR[c.level]}`} style={{ width: `${Math.min(100, (c.nights / thresholds.cap) * 100)}%` }} />
                </div>
                <p className="text-xs font-medium text-slate">{td('ofLimit', { cap: thresholds.cap })}</p>
              </>
            )}
          </div>
        ) : (
          <div className={`${sectionClass} flex flex-col gap-1.5 pt-4 pb-5`}>
            <Meta>{t('counterTitle')}</Meta>
            <p className="text-sm text-carbon">{td('notApplicable')}</p>
          </div>
        ))}

      {flags.length > 0 && (
        <div className="flex flex-wrap gap-2 px-6 pb-4">
          {flags.map((f) => (
            <StatusPill key={f.label} tone={f.tone}>
              {f.label}
            </StatusPill>
          ))}
        </div>
      )}

      <div aria-hidden className="mt-auto flex min-h-13 items-center justify-between border-t border-bone px-6 font-display text-sm font-bold text-ink">
        <span>{t('view')}</span>
        <Icon name="arrowRight" size={18} className="transition-transform duration-150 group-hover:translate-x-[3px] rtl:-scale-x-100 rtl:group-hover:-translate-x-[3px]" />
      </div>
    </article>
  );
}

/** Placeholder with the card's shape while the list loads. */
export function PropertyCardSkeleton() {
  const bar = 'rounded-pill bg-mercury';
  return (
    <div aria-hidden className="flex min-h-[348px] flex-col rounded-card border border-bone bg-card">
      <div className="flex gap-3.5 px-6 pt-6 pb-5">
        <div className="size-11 rounded-card bg-mercury" />
        <div className="flex flex-1 flex-col gap-2.5 pt-1">
          <div className="flex justify-between gap-3">
            <div className={`h-4 w-[55%] ${bar}`} />
            <div className={`h-5 w-18 ${bar}`} />
          </div>
          <div className={`h-2.5 w-[35%] ${bar}`} />
        </div>
      </div>
      <div className={`${sectionClass} flex flex-col gap-3 py-4`}>
        <div className={`h-3 w-4/5 ${bar}`} />
        <div className={`h-3 w-1/2 ${bar}`} />
      </div>
      <div className={`${sectionClass} flex flex-col gap-3 pt-4 pb-5`}>
        <div className={`h-2.5 w-[30%] ${bar}`} />
        <div className={`h-6 w-[22%] ${bar}`} />
        <div className={`h-1.5 w-full ${bar}`} />
      </div>
      <div className="mt-auto h-13 border-t border-bone" />
    </div>
  );
}
