import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from './config';

/** Locale comes from a cookie (no /fr or /en in URLs), so token links stay short and stable. */
export default getRequestConfig(async () => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(value) ? value : DEFAULT_LOCALE;
  return { locale, messages: (await import(`../messages/${locale}.json`)).default };
});
