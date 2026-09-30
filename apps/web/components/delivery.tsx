'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '../lib/api';
import type { Delivery, DeliveryResult, DeliveryStatus as Status } from '../lib/types';
import { useSubmit } from '../lib/use-submit';
import { Alert, Button, Field, fieldAria, Input, StatusPill } from './ui';

const TONE: Record<Status, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = { QUEUED: 'neutral', SENT: 'info', DELIVERED: 'success', READ: 'success', FAILED: 'danger', FELL_BACK: 'warning' };

/** Optional number to send the link to from Dari. Used for one message and never kept (the hint says so). */
export function WhatsappNumberField({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string }) {
  const t = useTranslations('delivery');
  const tc = useTranslations('common');
  return (
    <Field id={id} label={t('whatsappTo')} hint={t('whatsappToHint')} error={error} optional={tc('optional')}>
      <Input {...fieldAria(id, error, t('whatsappToHint'))} type="tel" inputMode="tel" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} className="max-w-72" dir="ltr" />
    </Field>
  );
}

/** What the send did, in words: delivered by WhatsApp, or why it was not and what to do instead. Nothing here quotes a provider. */
export function DeliveryNote({ delivery }: { delivery: DeliveryResult | null }) {
  const t = useTranslations('delivery');
  if (!delivery) return null;
  const sent = delivery.channel !== null && delivery.status !== null && delivery.status !== 'FAILED';
  if (sent) return <Alert tone="success">{t('sentNow', { channel: t(delivery.channel!), status: t(delivery.status!) })}</Alert>;
  return (
    <Alert tone="warning">
      {delivery.skipped && delivery.skipped !== 'NO_NUMBER' ? t(`skipped_${delivery.skipped}`) : t('notSent')}
    </Alert>
  );
}

/** Loaded on request, so an arrivals list does not fire one call per stay. */
export function DeliveryStatus({ linkId }: { linkId: string }) {
  const t = useTranslations('delivery');
  const load = useSubmit();
  const [rows, setRows] = useState<Delivery[] | null>(null);

  async function show() {
    const r = await load.run(() => api<Delivery[]>('GET', `/checkin-links/${linkId}/deliveries`));
    if (r) setRows(r);
  }

  if (rows === null) {
    return (
      <div className="space-y-2">
        <Button variant="ghost" onClick={() => void show()} disabled={load.pending}>
          {t('show')}
        </Button>
        {load.error && <Alert>{load.error}</Alert>}
      </div>
    );
  }
  if (rows.length === 0) return <p className="text-sm text-slate">{t('none')}</p>;
  return (
    <ul className="space-y-1.5" aria-label={t('title')}>
      {rows.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t(d.channel)}</span>
          <StatusPill tone={TONE[d.status]}>{t(d.status)}</StatusPill>
          {d.failureCode && <span className="text-slate">{t.has(`failure_${d.failureCode}`) ? t(`failure_${d.failureCode}`) : ''}</span>}
        </li>
      ))}
    </ul>
  );
}
