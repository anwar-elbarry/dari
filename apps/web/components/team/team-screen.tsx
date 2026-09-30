'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import type { Invitation, Role, TeamMember, TeamOverview } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { Alert, Button, Card, Field, fieldAria, Input, Meta, Select, StatusPill } from '../ui';

const INVITABLE: Role[] = ['STAFF', 'ACCOUNTANT'];

/**
 * Members, seats and invitations. The seat limit, who may be changed and what a change does are decided by the API;
 * this screen only hides what would be refused (an owner's row, your own row). Owners are read-only here.
 */
export function TeamScreen() {
  const t = useTranslations('team');
  const tr = useTranslations('roles');
  const format = useFormatter();
  const { me } = useSession();
  const [team, setTeam] = useState<TeamOverview | null>(null);
  const [pending, setPending] = useState<Invitation[]>([]);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const invite = useSubmit();
  const change = useSubmit();
  const invitation = useSubmit();

  const load = useCallback(async () => {
    try {
      const [o, i] = await Promise.all([api<TeamOverview>('GET', '/users'), api<Invitation[]>('GET', '/invitations')]);
      setTeam(o);
      setPending(i);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
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

  async function update(m: TeamMember, body: { role?: Role; disabled?: boolean }, done: string) {
    setNotice(null);
    if (await change.run(() => api('PATCH', `/users/${m.id}`, body))) {
      setNotice(done);
    }
    await load(); // also after a refusal: the list may have moved (a seat taken meanwhile)
  }

  async function resend(i: Invitation) {
    setNotice(null);
    if (await invitation.run(() => api('POST', `/invitations/${i.id}/resend`).then(() => true))) setNotice(t('resent', { email: i.email }));
  }

  async function revoke(id: string) {
    setNotice(null);
    if (await invitation.run(() => api('DELETE', `/invitations/${id}`).then(() => true))) {
      setNotice(t('revoked'));
      await load();
    }
  }

  const full = team ? team.seats.used >= team.seats.limit : false;
  const pct = team ? Math.min(100, Math.round((team.seats.used / Math.max(1, team.seats.limit)) * 100)) : 0;
  const errors = change.error ?? invitation.error;

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate">{t('intro')}</p>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {errors && <Alert>{errors}</Alert>}
      {failed && <Alert>{t('loadFailed')}</Alert>}

      {team && (
        <Card className="space-y-3">
          <Meta>{t('seats')}</Meta>
          <p className="font-display text-lg font-semibold">{t('seatsUsed', { used: team.seats.used, limit: team.seats.limit })}</p>
          <div className="h-2 overflow-hidden rounded-pill bg-mercury" role="progressbar" aria-valuemin={0} aria-valuemax={team.seats.limit} aria-valuenow={team.seats.used} aria-label={t('seatsUsed', { used: team.seats.used, limit: team.seats.limit })}>
            <div className={`h-full rounded-pill ${full ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-slate">{full ? t('seatsFull') : t('seatsHelp')}</p>
        </Card>
      )}

      {team && (
        <Card className="space-y-4">
          <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('members')}</h2>
          <ul className="divide-y divide-bone">
            {team.members.map((m) => {
              const isMe = m.id === me.user.id;
              const manageable = !isMe && m.role !== 'OWNER_MANAGER';
              return (
                <li key={m.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {m.name} {isMe && <span className="text-sm font-normal text-slate">({t('you')})</span>}
                    </p>
                    <p className="truncate text-sm text-slate">{m.email}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate">
                      <StatusPill tone={m.disabled ? 'neutral' : 'success'}>{m.disabled ? t('disabled') : t('active')}</StatusPill>
                      <span>{m.lastLoginAt ? t('lastLogin', { date: format.dateTime(new Date(m.lastLoginAt), { dateStyle: 'medium' }) }) : t('neverLogin')}</span>
                    </p>
                  </div>
                  {manageable ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select aria-label={t('roleFor', { name: m.name })} value={m.role} disabled={change.pending || m.disabled} onChange={(e) => void update(m, { role: e.target.value as Role }, t('roleDone', { name: m.name }))} className="w-auto min-w-40">
                        {INVITABLE.map((r) => (
                          <option key={r} value={r}>
                            {tr(r)}
                          </option>
                        ))}
                      </Select>
                      <Button variant={m.disabled ? 'ghost' : 'danger'} disabled={change.pending} onClick={() => void update(m, { disabled: !m.disabled }, t(m.disabled ? 'enabledDone' : 'disabledDone', { name: m.name }))}>
                        {m.disabled ? t('enable') : t('disable')}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-slate">{tr(m.role)}{m.role === 'OWNER_MANAGER' && !isMe ? ` · ${t('ownerNote')}` : ''}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card className="space-y-4">
        <form onSubmit={onInvite} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field id="email" label={t('email')} error={invite.fieldErrors.email}>
              <Input {...fieldAria('email', invite.fieldErrors.email)} type="email" required autoComplete="off" />
            </Field>
            <Field id="role" label={t('role')}>
              <Select {...fieldAria('role')} defaultValue="STAFF">
                {INVITABLE.map((r) => (
                  <option key={r} value={r}>
                    {tr(r)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {invite.error && <Alert>{invite.error}</Alert>}
          <Button type="submit" disabled={invite.pending}>
            {t('invite')}
          </Button>
        </form>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('pending')}</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-slate">{t('none')}</p>
        ) : (
          <ul className="divide-y divide-bone">
            {pending.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.email}</p>
                  <p className="text-sm text-slate">
                    {tr(i.role)} · {t('expires', { date: format.dateTime(new Date(i.expiresAt), { dateStyle: 'medium' }) })}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" disabled={invitation.pending} onClick={() => void resend(i)}>
                    {t('resend')}
                  </Button>
                  <Button variant="danger" disabled={invitation.pending} onClick={() => void revoke(i.id)}>
                    {t('revoke')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
