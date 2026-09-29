'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, fieldAria, Input, Select, StatusPill } from '../ui';
import { api, ApiError } from '../../lib/api';
import type { Feed, Platform, SyncResult } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';

const PLATFORMS: Platform[] = ['AIRBNB', 'BOOKING', 'DIRECT', 'OTHER'];
const TONE = { OK: 'success', ERROR: 'danger', NEVER: 'neutral' } as const;

/** Calendar links of one property. The iCal URL is a secret: shown only to users who can manage feeds. */
export function FeedsPanel({ propertyId, onChanged }: { propertyId: string; onChanged: () => void }) {
  const t = useTranslations('feeds');
  const tp = useTranslations('property');
  const format = useFormatter();
  const [feeds, setFeeds] = useState<Feed[] | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const add = useSubmit();

  const load = useCallback(() => api<Feed[]>('GET', `/properties/${propertyId}/feeds`).then(setFeeds), [propertyId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setNotice(null);
    try {
      const feed = await api<Feed>('POST', `/properties/${propertyId}/feeds`, { platform: f.get('platform'), url: f.get('url') });
      form.reset();
      setNotice({ tone: 'success', text: t('added') });
      await load();
      await syncFeed(feed.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'FEED_EXISTS') setNotice({ tone: 'error', text: t('errors.FEED_EXISTS') });
      else await add.run(() => Promise.reject(err));
    }
  }

  async function syncFeed(feedId: string) {
    setBusy(feedId);
    setNotice(null);
    try {
      const r = await api<SyncResult>('POST', `/properties/${propertyId}/feeds/${feedId}/sync`);
      setNotice(r.ok ? { tone: 'success', text: t('synced', { created: r.created, updated: r.updated, cancelled: r.cancelled }) } : { tone: 'error', text: t('syncFailed', { error: r.error ?? '' }) });
      await load();
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function remove(feedId: string) {
    setBusy(feedId);
    try {
      await api('DELETE', `/properties/${propertyId}/feeds/${feedId}`);
      setNotice({ tone: 'success', text: t('removed') });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{tp('calendars')}</h2>
        <p className="mt-1 text-sm text-slate">{t('intro')}</p>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {feeds && feeds.length === 0 && <p className="text-sm text-slate">{t('none')}</p>}
      <ul className="grid gap-3">
        {feeds?.map((feed) => (
          <li key={feed.id} className="space-y-3 rounded-card border border-bone p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-display font-semibold">{tp(`source.${feed.platform}`)}</span>
                <StatusPill tone={TONE[feed.lastStatus]}>{t(`status.${feed.lastStatus}`)}</StatusPill>
              </div>
              <p className="text-xs text-slate">{t('events', { count: feed.eventCount })}</p>
            </div>
            <p className="text-sm text-slate">{feed.lastSyncedAt ? t('lastSync', { date: format.dateTime(new Date(feed.lastSyncedAt), { dateStyle: 'medium', timeStyle: 'short' }) }) : t('never')}</p>
            {feed.lastError && <p className="text-sm text-danger">{feed.lastError}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => syncFeed(feed.id)} disabled={busy === feed.id}>
                {t('syncNow')}
              </Button>
              <Button variant="danger" onClick={() => remove(feed.id)} disabled={busy === feed.id}>
                {t('remove')}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={onAdd} className="grid gap-4 border-t border-bone pt-5">
        {add.error && <Alert>{add.error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field id="platform" label={t('platform')}>
            <Select {...fieldAria('platform')} defaultValue="AIRBNB">
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {tp(`source.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="url" label={t('url')} hint={t('urlHelp')} error={add.fieldErrors.url}>
            <Input {...fieldAria('url', add.fieldErrors.url, t('urlHelp'))} type="url" inputMode="url" autoComplete="off" spellCheck={false} required maxLength={2048} placeholder="https://" />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={add.pending}>
            {t('add')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
