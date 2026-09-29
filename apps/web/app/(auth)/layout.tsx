import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitch } from '../../components/locale-switch';
import { Logo } from '../../components/logo';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('common');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Logo size={40} surface="#f8f9fa" />
          <span className="sr-only">{t('appName')}</span>
          <p className="mt-1 text-sm text-slate">{t('tagline')}</p>
        </div>
        <LocaleSwitch />
      </div>
      <div className="rounded-card border border-bone bg-white p-5 shadow-sm sm:p-7">{children}</div>
    </main>
  );
}
