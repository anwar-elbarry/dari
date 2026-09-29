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
          <Logo size={36} />
          <p className="mt-2 text-sm text-slate">{t('tagline')}</p>
        </div>
        <LocaleSwitch />
      </div>
      <div className="rounded-card border border-bone bg-card p-5 shadow-sm sm:p-7">{children}</div>
    </main>
  );
}
