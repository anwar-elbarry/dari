'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { CreatedShare, ShareLifetime, ShareTarget } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { fillTemplate, whatsappUrl } from '../checkin/share';
import { Alert, Button, buttonClass, Dialog, Field, fieldAria, Input } from '../ui';

/**
 * Creates a Secure Share link for one Fiche or one register and shows it ONCE. The token exists only in this
 * component's state while the dialog is open; closing it drops it. The allowed durations come from the API
 * (RuleConfig), never from this file.
 */
export function ShareDialog({ target, title, onClose, onChanged }: { target: ShareTarget | null; title: string; onClose: () => void; onChanged?: () => void }) {
  const t = useTranslations('share.dialog');
  const tc = useTranslations('common');
  const format = useFormatter();
  const submit = useSubmit();
  const [bounds, setBounds] = useState<ShareLifetime | null>(null);
  const [boundsFailed, setBoundsFailed] = useState(false);
  const [hours, setHours] = useState('');
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<CreatedShare | null>(null);
  const [copied, setCopied] = useState(false);
  const open = target !== null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBoundsFailed(false);
    api<ShareLifetime>('GET', '/shares/lifetime')
      .then((b) => {
        if (cancelled) return;
        setBounds(b);
        setHours(String(b.minHours)); // the shortest allowed duration is the default
      })
      .catch(() => !cancelled && setBoundsFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open]);

  function close() {
    setCreated(null); // the token is gone from memory
    setCopied(false);
    setLabel('');
    submit.setError(null);
    onClose();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    const body =
      target.type === 'FICHE_DE_POLICE'
        ? { resourceType: target.type, guestId: target.guestId, expiresInHours: Number(hours), recipientLabel: label }
        : { resourceType: target.type, propertyId: target.propertyId, month: target.month, expiresInHours: Number(hours), recipientLabel: label };
    const share = await submit.run(() => api<CreatedShare>('POST', '/shares', body));
    if (share) {
      setCreated(share);
      onChanged?.();
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      document.getElementById('share-url')?.focus();
    }
  }

  const until = created ? format.dateTime(new Date(created.expiresAt), { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const message = created ? fillTemplate(t('message'), { date: until, url: created.url }) : '';

  return (
    <Dialog open={open} onClose={close} title={title} closeLabel={tc('cancel')}>
      <div className="space-y-4">
        {submit.error && <Alert>{submit.error}</Alert>}
        {boundsFailed && <Alert>{t('loadFailed')}</Alert>}

        {!created && (
          <form className="space-y-4" onSubmit={create} noValidate>
            <Alert tone="warning">{t('notice')}</Alert>
            <Field id="share-hours" label={t('hours')} hint={bounds ? t('hoursHint', { min: bounds.minHours, max: bounds.maxHours }) : undefined} error={submit.fieldErrors.expiresInHours}>
              <Input {...fieldAria('share-hours', submit.fieldErrors.expiresInHours, bounds ? 'x' : undefined)} type="number" inputMode="numeric" min={bounds?.minHours} max={bounds?.maxHours} required value={hours} onChange={(e) => setHours(e.target.value)} className="max-w-32" />
            </Field>
            <Field id="share-label" label={t('label')} hint={t('labelHint')} error={submit.fieldErrors.recipientLabel}>
              <Input {...fieldAria('share-label', submit.fieldErrors.recipientLabel, t('labelHint'))} required minLength={2} maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
            </Field>
            <Button type="submit" disabled={submit.pending || !bounds || label.trim().length < 2}>
              {t('create')}
            </Button>
          </form>
        )}

        {created && (
          <div className="space-y-4">
            <Alert tone="warning">{t('once')}</Alert>
            <Field id="share-url" label={t('linkLabel')} hint={t('expires', { date: until })}>
              <Input id="share-url" name="share-url" readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-sm" dir="ltr" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="dark" onClick={copy}>
                {copied ? t('copied') : t('copy')}
              </Button>
              <a href={whatsappUrl(message)} target="_blank" rel="noopener noreferrer" className={buttonClass('primary')}>
                {t('whatsapp')}
              </a>
            </div>
            <p className="text-sm text-slate">{t('whatsappNote')}</p>
            <Button variant="ghost" onClick={close}>
              {t('done')}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
