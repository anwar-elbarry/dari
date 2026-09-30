'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { SessionProvider, useSession } from '../lib/session';
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

function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const { me, can, logout } = useSession();

  // Navigation is filtered for convenience only; the API enforces every permission.
  const links = [
    can('booking:read') && { href: '/dashboard', label: t('nav.dashboard') },
    can('property:read') && { href: '/properties', label: t('nav.properties') },
    can('share:manage') && { href: '/shares', label: t('nav.shares') },
    can('team:manage') && { href: '/team', label: t('nav.team') },
    me.user.role !== 'STAFF' && { href: '/reports', label: t('nav.reports') },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[14rem_1fr]">
      <aside className="border-b border-bone bg-card md:min-h-dvh md:border-b-0 md:border-e">
        <div className="flex items-center justify-between px-4 py-3 md:block md:px-5 md:py-5">
          <div>
            <Logo size={30} />
            <p className="mt-1 max-w-[12rem] truncate text-xs text-slate">{me.account.companyName}</p>
          </div>
          <div className="md:hidden">
            <LocaleSwitch />
          </div>
        </div>
        <nav aria-label={t('nav.menu')} className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-pill px-4 font-display text-sm font-semibold ${active ? 'bg-brand-50 text-link' : 'text-carbon hover:bg-mercury'}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-end gap-3 border-b border-bone bg-card px-4 py-2">
          <div className="hidden md:block">
            <LocaleSwitch />
          </div>
          <div className="text-right text-sm leading-tight">
            <p className="font-display font-semibold">{me.user.name}</p>
            <p className="text-xs text-slate">{t(`roles.${me.user.role}`)}</p>
          </div>
          <button type="button" onClick={logout} className="min-h-11 rounded-pill px-3 font-display text-sm font-semibold text-carbon hover:bg-mercury">
            {t('common.logout')}
          </button>
        </header>
        <main className="mx-auto w-full max-w-4xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
