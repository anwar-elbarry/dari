'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import { useSubmit } from '../../lib/use-submit';
import { Alert, Button, Field, fieldAria, Input } from '../ui';

export function SignupForm() {
  const t = useTranslations('auth.signup');
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { companyName: f.get('companyName'), name: f.get('name'), email: f.get('email'), password: f.get('password') };
    if (await run(() => api('POST', '/auth/signup', body))) router.replace('/properties/new');
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-2xl font-bold tracking-[-0.02em]">{t('title')}</h1>
      {error && <Alert>{error}</Alert>}
      <Field id="companyName" label={t('companyName')} error={fieldErrors.companyName}>
        <Input {...fieldAria('companyName', fieldErrors.companyName)} autoComplete="organization" required minLength={2} maxLength={120} />
      </Field>
      <Field id="name" label={t('name')} error={fieldErrors.name}>
        <Input {...fieldAria('name', fieldErrors.name)} autoComplete="name" required minLength={2} maxLength={120} />
      </Field>
      <Field id="email" label={t('email')} error={fieldErrors.email}>
        <Input {...fieldAria('email', fieldErrors.email)} type="email" autoComplete="email" inputMode="email" required />
      </Field>
      <Field id="password" label={t('password')} hint={t('passwordHint')} error={fieldErrors.password}>
        <Input {...fieldAria('password', fieldErrors.password, t('passwordHint'))} type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {t('submit')}
      </Button>
      <p className="text-sm text-slate">
        {t('haveAccount')}{' '}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          {t('loginLink')}
        </Link>
      </p>
    </form>
  );
}
