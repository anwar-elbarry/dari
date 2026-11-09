import Link from 'next/link';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Rings } from '../../components/decor';
import { Icon, type IconName } from '../../components/icons';
import { LocaleSwitch } from '../../components/locale-switch';
import { Logo } from '../../components/logo';
import { IconChip, StatusPill } from '../../components/ui';

/**
 * Sign-in, sign-up, password reset and invitation pages: the form on one side, the product on a lime panel on the
 * other (large screens only). Token pages use this layout too: nothing here loads a third-party resource.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('common');
  const th = await getTranslations('home');
  const features: { icon: IconName; title: string }[] = [
    { icon: 'calendar', title: th('features.nights.title') },
    { icon: 'clipboard', title: th('features.checkin.title') },
    { icon: 'report', title: th('features.tax.title') },
  ];
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1fr_1.05fr]">
      <main className="flex min-h-dvh flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="no-underline">
            <Logo size={34} />
          </Link>
          <LocaleSwitch />
        </div>
        <div className="mx-auto w-full max-w-md py-8 sm:my-auto sm:py-10">
          <p className="mb-4 text-sm text-slate">{t('tagline')}</p>
          <div className="rounded-card-lg border border-bone bg-card p-5 shadow-sm sm:p-7">{children}</div>
        </div>
      </main>

      <aside className="hidden p-3 lg:block">
        <div className="relative flex h-full min-h-[calc(100dvh-1.5rem)] flex-col justify-between overflow-hidden rounded-card-lg bg-primary p-12 text-on-primary">
          <Rings className="-end-24 -top-24" />
          <div className="relative max-w-md space-y-6">
            <p className="font-display text-4xl leading-[1.1] font-medium tracking-[-0.035em]">
              {th('hero.title')} <strong className="font-bold">{th('hero.titleStrong')}</strong>
            </p>
            <ul className="space-y-3">
              {features.map((f) => (
                <li key={f.title} className="flex items-center gap-3 font-display text-base font-semibold">
                  <IconChip tone="dark">
                    <Icon name={f.icon} size={18} />
                  </IconChip>
                  {f.title}
                </li>
              ))}
            </ul>
          </div>
          <div aria-hidden className="relative flex max-w-sm items-center gap-3 rounded-card-lg border border-bone bg-card p-4 text-ink shadow-[var(--shadow-lift)]">
            <IconChip tone="dark">
              <Icon name="users" size={18} />
            </IconChip>
            <div className="min-w-0 space-y-1.5">
              <p className="font-display text-sm font-semibold">{th('illus.arrivals')}</p>
              <p className="text-sm text-slate">{th('illus.guests')}</p>
              <StatusPill tone="success">{th('illus.fiche')}</StatusPill>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
