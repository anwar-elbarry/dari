'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import type { PropertyReduced, ShareAccessRow, ShareRow, ShareStatus } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { Alert, Button, Card, Dialog, StatusPill } from '../ui';

const TONE: Record<ShareStatus, 'success' | 'neutral' | 'danger'> = { ACTIVE: 'success', EXPIRED: 'neutral', REVOKED: 'danger' };

/** The links the manager gave out: status, views, revoke, and who opened each one. Owner/Manager only. */
export function SharesScreen() {
  const t = useTranslations('share');
  const tc = useTranslations('common');
  const format = useFormatter();
  const [shares, setShares] = useState<ShareRow[] | null>(null);
  const [properties, setProperties] = useState<Map<string, string>>(new Map());
  const [state, setState] = useState<'ok' | 'failed' | 'unavailable'>('ok');
  const [notice, setNotice] = useState<string | null>(null);
  const [revokeFor, setRevokeFor] = useState<ShareRow | null>(null);
  const [logFor, setLogFor] = useState<ShareRow | null>(null);
  const [log, setLog] = useState<ShareAccessRow[] | null>(null);
  const revoke = useSubmit();
  const logSubmit = useSubmit();

  const load = useCallback(async () => {
    try {
      const [list, props] = await Promise.all([api<ShareRow[]>('GET', '/shares'), api<PropertyReduced[]>('GET', '/properties').catch(() => [] as PropertyReduced[])]);
      setShares(list);
      setProperties(new Map(props.map((p) => [p.id, p.name])));
      setState('ok');
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? 'unavailable' : 'failed');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const monthLabel = (month: string) => format.dateTime(new Date(`${month}-01`), { month: 'long', year: 'numeric', timeZone: 'UTC' });

  function resource(s: ShareRow) {
    if (s.resourceType === 'POLICE_REGISTER') {
      const name = s.resource.propertyId ? properties.get(s.resource.propertyId) : undefined;
      return `${t('resource.POLICE_REGISTER', { month: s.resource.month ? monthLabel(s.resource.month) : '' })}${name ? ` · ${name}` : ''}`;
    }
    return t('resource.FICHE_DE_POLICE');
  }

  async function openLog(s: ShareRow) {
    setLogFor(s);
    setLog(null);
    const rows = await logSubmit.run(() => api<ShareAccessRow[]>('GET', `/shares/${s.id}/access`));
    if (rows) setLog(rows);
  }

  async function confirmRevoke() {
    if (!revokeFor) return;
    const id = revokeFor.id;
    if (await revoke.run(() => api('DELETE', `/shares/${id}`).then(() => true))) {
      setRevokeFor(null);
      setNotice(t('revoked'));
      await load();
    }
  }

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        <p className="text-sm text-slate">{t('intro')}</p>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {state === 'failed' && <Alert>{t('loadFailed')}</Alert>}
      {state === 'unavailable' && <Alert tone="info">{t('unavailable')}</Alert>}
      {shares && shares.length === 0 && <p className="text-sm text-slate">{t('empty')}</p>}

      <ul className="space-y-4">
        {shares?.map((s) => (
          <li key={s.id}>
            <Card className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-semibold">{resource(s)}</h2>
                  <p className="text-sm text-slate" dir="auto">
                    {t('recipient', { label: s.recipientLabel })}
                  </p>
                </div>
                <StatusPill tone={TONE[s.status]}>{t(`status.${s.status}`, { date: when(s.expiresAt) })}</StatusPill>
              </div>
              <p className="text-sm text-slate">
                {t('views', { count: s.viewCount })}
                {s.lastAccessAt ? ` · ${t('lastAccess', { date: when(s.lastAccessAt) })}` : ''}
              </p>
              <div className="flex flex-wrap gap-2 border-t border-bone pt-3">
                <Button variant="ghost" onClick={() => openLog(s)}>
                  {t('accessLog')}
                </Button>
                {s.status === 'ACTIVE' && (
                  <Button variant="danger" onClick={() => setRevokeFor(s)}>
                    {t('revoke')}
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Dialog open={revokeFor !== null} onClose={() => setRevokeFor(null)} title={t('revokeTitle')} closeLabel={tc('cancel')}>
        <div className="space-y-4">
          <p className="text-sm text-slate">{t('revokeBody')}</p>
          {revoke.error && <Alert>{revoke.error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button variant="dark" onClick={confirmRevoke} disabled={revoke.pending}>
              {t('revokeConfirm')}
            </Button>
            <Button variant="ghost" onClick={() => setRevokeFor(null)}>
              {tc('cancel')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={logFor !== null} onClose={() => setLogFor(null)} title={t('accessTitle')} closeLabel={tc('cancel')}>
        <div className="space-y-4">
          <p className="text-sm text-slate">{t('accessNote')}</p>
          {logSubmit.error && <Alert>{logSubmit.error}</Alert>}
          {log && log.length === 0 && <p className="text-sm text-slate">{t('accessEmpty')}</p>}
          {log && log.length > 0 && (
            <ul className="divide-y divide-bone rounded-card border border-bone text-sm">
              {log.map((row, i) => (
                <li key={`${row.at}-${i}`} className="grid gap-0.5 px-3 py-2">
                  <span className="font-medium tabular-nums">{when(row.at)}</span>
                  <span className="break-words text-slate" dir="ltr">
                    {row.userAgent || '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button variant="ghost" onClick={() => setLogFor(null)}>
            {t('close')}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
