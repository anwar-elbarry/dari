import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitch } from '../../components/locale-switch';
import { Logo } from '../../components/logo';

/** Public token pages are never indexed (the site also sends X-Robots-Tag and no-store for /checkin). */
export const metadata: Metadata = { title: 'Dari', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };

/** Guest pages: no navigation, no account. Just the brand and the language. */
export default async function GuestLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('guest');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Logo size={32} />
          <p className="mt-1 text-sm text-slate">{t('title')}</p>
        </div>
        <LocaleSwitch />
      </header>
      {children}
    </main>
  );
}
