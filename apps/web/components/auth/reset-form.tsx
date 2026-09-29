'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '../../lib/api';
import { useSubmit } from '../../lib/use-submit';
import { Alert, Button, Field, fieldAria, Input } from '../ui';
import { useHashToken } from './use-hash-token';

export function ResetForm() {
  const t = useTranslations('auth.reset');
  const ts = useTranslations('auth.signup');
  const [done, setDone] = useState(false);
  const { pending, error, fieldErrors, run } = useSubmit();
  const token = useHashToken();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if ((await run(() => api('POST', '/auth/reset-password', { token, password: f.get('password') }).then(() => true))) === true) setDone(true);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      {token === undefined ? null : !token ? (
        <Alert>{t('missingToken')}</Alert>
      ) : done ? (
        <Alert tone="success">{t('done')}</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field id="password" label={t('password')} hint={ts('passwordHint')} error={fieldErrors.password}>
            <Input {...fieldAria('password', fieldErrors.password, ts('passwordHint'))} type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
          </Field>
          <Button type="submit" disabled={pending} className="w-full">
            {t('submit')}
          </Button>
        </form>
      )}
      {(done || token === null) && (
        <Link href="/login" className="block text-sm font-medium text-brand-700 hover:underline">
          {t('backToLogin')}
        </Link>
      )}
    </div>
  );
}
