'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Role } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { Alert, Button, Field, fieldAria, Input } from '../ui';
import { useHashToken } from './use-hash-token';

interface Preview {
  email: string;
  role: Role;
  companyName: string;
}

export function AcceptForm() {
  const t = useTranslations('auth.accept');
  const tr = useTranslations('roles');
  const ts = useTranslations('auth.signup');
  const tc = useTranslations('common');
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null | 'invalid'>(null);
  const { pending, error, fieldErrors, run } = useSubmit();
  const token = useHashToken();

  useEffect(() => {
    if (token === undefined) return;
    if (!token) return setPreview('invalid');
    api<Preview>('POST', '/invitations/preview', { token })
      .then(setPreview)
      .catch(() => setPreview('invalid'));
  }, [token]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (await run(() => api('POST', '/invitations/accept', { token, name: f.get('name'), password: f.get('password') }))) router.replace('/');
  }

  if (preview === null) return <p className="text-sm text-slate">{tc('loading')}</p>;
  if (preview === 'invalid') {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        <Alert>{t('invalid')}</Alert>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
      <p className="text-sm text-slate">{t('intro', { company: preview.companyName, role: tr(preview.role) })}</p>
      {error && <Alert>{error}</Alert>}
      <Field id="email" label={t('email')}>
        <Input {...fieldAria('email')} value={preview.email} readOnly disabled />
      </Field>
      <Field id="name" label={t('name')} error={fieldErrors.name}>
        <Input {...fieldAria('name', fieldErrors.name)} autoComplete="name" required minLength={2} maxLength={120} />
      </Field>
      <Field id="password" label={t('password')} hint={ts('passwordHint')} error={fieldErrors.password}>
        <Input {...fieldAria('password', fieldErrors.password, ts('passwordHint'))} type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {t('submit')}
      </Button>
    </form>
  );
}
