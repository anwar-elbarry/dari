'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Require } from '../../../components/require';
import { Alert, Button, Card, Field, fieldAria, Input, Select } from '../../../components/ui';
import { api } from '../../../lib/api';
import type { Invitation } from '../../../lib/types';
import { useSubmit } from '../../../lib/use-submit';

/** Minimal invite screen for Phase 1. Role changes, removal and seat limits come with team management (Phase 6). */
export default function TeamPage() {
  return (
    <Require capability="team:manage">
      <Team />
    </Require>
  );
}

function Team() {
  const t = useTranslations('team');
  const tr = useTranslations('roles');
  const format = useFormatter();
  const [pending, setPending] = useState<Invitation[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const invite = useSubmit();
  const revoke = useSubmit();

  const load = useCallback(() => api<Invitation[]>('GET', '/invitations').then(setPending), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function onInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const email = String(f.get('email'));
    setNotice(null);
    if (await invite.run(() => api('POST', '/invitations', { email, role: f.get('role') }))) {
      form.reset();
      setNotice(t('sent', { email }));
      await load();
    }
  }

  async function onRevoke(id: string) {
    setNotice(null);
    if ((await revoke.run(() => api('DELETE', `/invitations/${id}`).then(() => true))) === true) {
      setNotice(t('revoked'));
      await load();
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate">{t('intro')}</p>
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card>
        <form onSubmit={onInvite} className="grid gap-4 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
          <Field id="email" label={t('email')} error={invite.fieldErrors.email}>
            <Input {...fieldAria('email', invite.fieldErrors.email)} type="email" inputMode="email" required />
          </Field>
          <Field id="role" label={t('role')}>
            <Select {...fieldAria('role')} defaultValue="STAFF">
              <option value="STAFF">{tr('STAFF')}</option>
              <option value="ACCOUNTANT">{tr('ACCOUNTANT')}</option>
            </Select>
          </Field>
          <Button type="submit" disabled={invite.pending}>
            {t('invite')}
          </Button>
        </form>
        {invite.error && (
          <div className="mt-4">
            <Alert>{invite.error}</Alert>
          </div>
        )}
      </Card>
      <div className="space-y-3">
        <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('pending')}</h2>
        {revoke.error && <Alert>{revoke.error}</Alert>}
        {pending.length === 0 ? (
          <p className="text-sm text-slate">{t('none')}</p>
        ) : (
          <ul className="divide-y divide-bone rounded-card border border-bone bg-card">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-slate">
                    {tr(inv.role)} · {t('expires', { date: format.dateTime(new Date(inv.expiresAt), { dateStyle: 'medium' }) })}
                  </p>
                </div>
                <Button variant="danger" onClick={() => onRevoke(inv.id)} disabled={revoke.pending}>
                  {t('revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
