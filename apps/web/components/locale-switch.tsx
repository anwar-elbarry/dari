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
          className={`min-h-9 rounded-pill px-3 font-display text-xs font-bold uppercase ${l === locale ? 'bg-ink text-canvas' : 'text-carbon hover:bg-mercury'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
