'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { SUPPORT_EMAIL } from '../lib/contact';
import { SessionProvider, useSession } from '../lib/session';
import { Icon, type IconName } from './icons';
import { LocaleSwitch } from './locale-switch';
import { Logo } from './logo';

function Loading() {
  const t = useTranslations('common');
  return <p className="p-6 text-sm text-slate">{t('loading')}</p>;
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider fallback={<Loading />}>
      <Frame>{children}</Frame>
    </SessionProvider>
  );
}

type NavLink = { href: string; label: string; icon: IconName };

/** Screens laid out as a bento grid use the wide frame; forms and lists keep a reading width. */
const WIDE = ['/dashboard', '/properties'];
/** A property's own page (not /properties/new or its sub-pages) is a bento screen too. */
const isWide = (path: string) => WIDE.includes(path) || /^\/properties\/(?!new$)[^/]+$/.test(path);

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const { me, can, logout } = useSession();

  // Navigation is filtered for convenience only; the API enforces every permission.
  const sections = [
    {
      label: t('nav.sectionMain'),
      links: [
        can('booking:read') && { href: '/dashboard', label: t('nav.dashboard'), icon: 'home' },
        can('property:read') && { href: '/properties', label: t('nav.properties'), icon: 'building' },
        can('share:manage') && { href: '/shares', label: t('nav.shares'), icon: 'share' },
        can('report:read') && { href: '/reports', label: t('nav.reports'), icon: 'report' },
      ].filter(Boolean) as NavLink[],
    },
    {
      label: t('nav.sectionSettings'),
      links: [
        can('team:manage') && { href: '/team', label: t('nav.team'), icon: 'users' },
        can('team:manage') && { href: '/notifications', label: t('nav.notifications'), icon: 'bell' },
      ].filter(Boolean) as NavLink[],
    },
  ].filter((s) => s.links.length > 0);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`) || (href === '/reports' && pathname.startsWith('/tax/reports/'));
  const wide = isWide(pathname);

  const logoutButton = (className: string) => (
    <button type="button" onClick={logout} aria-label={t('common.logout')} className={`min-h-11 items-center justify-center gap-2 rounded-pill border border-bone bg-card px-3 font-display text-sm font-semibold text-carbon hover:bg-mercury ${className}`}>
      <Icon name="logout" size={18} className="rtl:-scale-x-100" />
      <span className="hidden lg:inline">{t('common.logout')}</span>
    </button>
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <aside className="border-b border-bone bg-card md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-b-0 md:border-e">
        <div className="flex items-center justify-between gap-2 px-4 py-3 md:px-5 md:pt-6 md:pb-4">
          <Logo size={30} />
          <div className="flex items-center gap-1 md:hidden">
            <LocaleSwitch />
            {logoutButton('inline-flex')}
          </div>
        </div>

        <div className="mx-4 mb-4 hidden items-center gap-3 rounded-card border border-bone bg-mist p-3 md:flex">
          <span aria-hidden className="inline-flex size-10 flex-none items-center justify-center rounded-pill bg-night font-display text-sm font-bold text-brand-500">
            {initials(me.user.name) || '·'}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate font-display text-sm font-semibold text-ink">{me.account.companyName}</p>
            <p className="truncate text-xs text-slate">{t(`roles.${me.user.role}`)}</p>
          </div>
        </div>

        <nav aria-label={t('nav.menu')} className="flex gap-1 overflow-x-auto px-2 pb-2 md:block md:space-y-5 md:overflow-y-auto md:px-3">
          {sections.map((s) => (
            <div key={s.label} className="flex gap-1 md:flex-col">
              <p className="hidden px-4 pb-1 font-mono text-[10px] leading-[1.6] font-medium tracking-[0.08em] text-slate uppercase md:block">{s.label}</p>
              {s.links.map((l) => {
                const active = isActive(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center gap-3 rounded-pill px-4 font-display text-sm font-semibold whitespace-nowrap ${active ? 'bg-brand-50 text-link' : 'text-carbon hover:bg-mercury'}`}
                  >
                    <Icon name={l.icon} size={18} />
                    {l.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="mt-auto hidden p-4 md:block">
          <div className="rounded-card-lg border border-bone bg-mist p-4 text-center">
            <span aria-hidden className="mx-auto mb-2 inline-flex size-10 items-center justify-center rounded-pill bg-night text-brand-500">
              <Icon name="help" size={20} />
            </span>
            <p className="font-display text-sm font-semibold text-ink">{t('shell.helpTitle')}</p>
            <p className="mt-1 text-xs text-slate">{t('shell.helpText')}</p>
            {SUPPORT_EMAIL && (
              <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-pill bg-ink px-4 font-display text-sm font-bold text-canvas no-underline hover:bg-carbon">
                <Icon name="mail" size={18} />
                {t('shell.helpContact')}
              </a>
            )}
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="hidden items-center justify-between gap-4 px-8 pt-6 md:flex">
          <div className="min-w-0">
            <p className="truncate font-display text-lg leading-tight font-semibold tracking-[-0.02em] text-ink">{t('shell.greeting', { name: me.user.name })}</p>
            <p className="truncate text-sm text-slate">{t('shell.subtitle')}</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <LocaleSwitch />
            {logoutButton('inline-flex')}
          </div>
        </header>
        <main className={`w-full px-4 py-6 md:px-8 ${wide ? 'max-w-7xl' : 'max-w-4xl'}`}>{children}</main>
      </div>
    </div>
  );
}
