import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LocaleSwitch } from '../../components/locale-switch';
import { Logo } from '../../components/logo';

/** Never indexed, never cached, no referrer (the site also sends X-Robots-Tag and no-store for /s). */
export const metadata: Metadata = { title: 'Dari', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };

/** The recipient of a shared link has no account: just the brand and the language, no navigation. */
export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <Logo size={32} />
        <LocaleSwitch />
      </header>
      {children}
    </main>
  );
}
