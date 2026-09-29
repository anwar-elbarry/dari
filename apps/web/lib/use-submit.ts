'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ApiError } from './api';

/** Runs an API call and turns ApiError into a translated message plus per-field errors. */
export function useSubmit() {
  const t = useTranslations('errors');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(t.has(e.code) ? t(e.code) : t('generic'));
        setFieldErrors(Object.fromEntries(Object.keys(e.fieldErrors()).map((f) => [f, t('field')])));
      } else {
        setError(t('generic'));
      }
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return { pending, error, fieldErrors, run, setError };
}
