'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { api, safeNext } from '../../lib/api';
import { useSubmit } from '../../lib/use-submit';
import { Alert, Button, Field, fieldAria, Input } from '../ui';

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations('auth.login');
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const ok = await run(() => api('POST', '/auth/login', { email: form.get('email'), password: form.get('password') }));
    if (ok) router.replace(safeNext(next, '/properties'));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
      <h1 className="text-2xl font-bold tracking-[-0.02em]">{t('title')}</h1>
      {error && <Alert>{error}</Alert>}
      <Field id="email" label={t('email')} error={fieldErrors.email}>
        <Input {...fieldAria('email', fieldErrors.email)} type="email" autoComplete="email" inputMode="email" required />
      </Field>
      <Field id="password" label={t('password')} error={fieldErrors.password}>
        <Input {...fieldAria('password', fieldErrors.password)} type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {t('submit')}
      </Button>
      <div className="flex flex-col gap-2 text-sm">
        <Link href="/forgot-password" className="text-brand-700 hover:underline">
          {t('forgot')}
        </Link>
        <p className="text-slate">
          {t('noAccount')}{' '}
          <Link href="/signup" className="font-medium text-brand-700 hover:underline">
            {t('signupLink')}
          </Link>
        </p>
      </div>
    </form>
  );
}
