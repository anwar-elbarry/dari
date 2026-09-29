import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitch } from '../../components/locale-switch';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('common');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xl font-semibold text-brand-700">{t('appName')}</p>
          <p className="text-sm text-stone-500">{t('tagline')}</p>
        </div>
        <LocaleSwitch />
      </div>
      <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">{children}</div>
    </main>
  );
}
