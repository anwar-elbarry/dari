'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { LOCALE_COOKIE, LOCALES } from '../i18n/config';

export function LocaleSwitch() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('common');

  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('language')}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={l === locale}
          onClick={() => {
            document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
            router.refresh();
          }}
          className={`min-h-9 rounded-md px-2 text-xs font-semibold uppercase ${l === locale ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
