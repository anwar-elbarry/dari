'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '../../lib/api';
import { useSubmit } from '../../lib/use-submit';
import { Alert, Button, Field, fieldAria, Input } from '../ui';

export function ForgotForm() {
  const t = useTranslations('auth.forgot');
  const tl = useTranslations('auth.login');
  const [sent, setSent] = useState(false);
  const { pending, error, run } = useSubmit();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if ((await run(() => api('POST', '/auth/forgot-password', { email: f.get('email') }).then(() => true))) === true) setSent(true);
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
      {sent ? (
        <Alert tone="success">{t('sent')}</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-sm text-slate">{t('intro')}</p>
          {error && <Alert>{error}</Alert>}
          <Field id="email" label={tl('email')}>
            <Input {...fieldAria('email')} type="email" autoComplete="email" inputMode="email" required />
          </Field>
          <Button type="submit" disabled={pending} className="w-full">
            {t('submit')}
          </Button>
        </form>
      )}
      <Link href="/login" className="block text-sm text-link hover:underline">
        {t('backToLogin')}
      </Link>
    </div>
  );
}
