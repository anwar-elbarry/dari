'use client';

import { useFormatter, useMessages, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { Arrival, CreatedLink } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { Alert, Button, buttonClass, Dialog, Field, fieldAria, Input, Tag } from '../ui';
import { fillTemplate, whatsappUrl } from './share';

type Lang = 'fr' | 'en';

/**
 * Creates (or re-issues) a check-in link and shows it ONCE. The token exists only in this component's state while
 * the dialog is open; closing it drops it. The message for the guest is written in the guest's language, which
 * can differ from the manager's interface language.
 */
export function LinkDialog({ arrival, propertyName, mode, onClose, onChanged }: { arrival: Arrival | null; propertyName: string; mode: 'create' | 'resend'; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations('checkin');
  const tc = useTranslations('common');
  const messages = useMessages() as { checkin: { share: { message: Record<Lang, string> } } };
  const format = useFormatter();
  const submit = useSubmit();
  const [maxGuests, setMaxGuests] = useState('2');
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [lang, setLang] = useState<Lang>('fr');
  const [copied, setCopied] = useState(false);
  const started = useRef(false);
  const open = arrival !== null;

  async function create(a: Arrival) {
    const link = await submit.run(() =>
      mode === 'resend' && a.link
        ? api<CreatedLink>('POST', `/checkin-links/${a.link.id}/resend`)
        : api<CreatedLink>('POST', `/bookings/${a.bookingId}/checkin-links`, { maxGuests: Number(maxGuests) }),
    );
    if (link) {
      setCreated(link);
      onChanged();
    }
  }

  // A re-issue needs no question: it keeps the party size.
  useEffect(() => {
    if (open && mode === 'resend' && arrival && !started.current) {
      started.current = true;
      void create(arrival);
    }
    if (!open) started.current = false;
    // `create` is recreated on every render on purpose; the ref guarantees the single run.
  }, [open, mode]);

  useEffect(() => {
    if (open) setMaxGuests(String(arrival?.partySize ?? arrival?.link?.maxGuests ?? 2));
  }, [open, arrival]);

  function close() {
    setCreated(null); // the token is gone from memory
    setCopied(false);
    submit.setError(null);
    onClose();
  }

  const day = (iso: string) => new Date(iso.slice(0, 10));
  const message =
    created && arrival
      ? fillTemplate(messages.checkin.share.message[lang], {
          property: propertyName,
          checkIn: new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(day(arrival.checkIn)),
          checkOut: new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(day(arrival.checkOut)),
          url: created.url,
        })
      : '';

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      document.getElementById('link-url')?.focus();
    }
  }

  return (
    <Dialog open={open} onClose={close} title={t('linkDialog.title')} closeLabel={tc('cancel')}>
      <div className="space-y-4">
        {submit.error && <Alert>{submit.error}</Alert>}

        {!created && mode === 'create' && arrival && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void create(arrival);
            }}
          >
            <Field id="party" label={t('linkDialog.party')} hint={t('linkDialog.partyHint')}>
              <Input {...fieldAria('party', submit.fieldErrors.maxGuests, t('linkDialog.partyHint'))} type="number" inputMode="numeric" min={1} max={10} required value={maxGuests} onChange={(e) => setMaxGuests(e.target.value)} className="max-w-28" />
            </Field>
            <Button type="submit" disabled={submit.pending}>
              {t('linkDialog.create')}
            </Button>
          </form>
        )}

        {!created && mode === 'resend' && submit.pending && <p className="text-sm text-slate">{tc('loading')}</p>}

        {created && (
          <div className="space-y-4">
            <Alert tone="warning">{t('linkDialog.once')}</Alert>
            <Field id="link-url" label={t('linkDialog.linkLabel')} hint={t('linkDialog.expires', { date: format.dateTime(new Date(created.expiresAt), { dateStyle: 'medium', timeZone: 'UTC' }) })}>
              <Input id="link-url" name="link-url" readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-sm" dir="ltr" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="dark" onClick={copy}>
                {copied ? t('linkDialog.copied') : t('linkDialog.copy')}
              </Button>
              <a href={whatsappUrl(message)} target="_blank" rel="noopener noreferrer" className={buttonClass('primary')}>
                {t('linkDialog.whatsapp')}
              </a>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('linkDialog.messageLanguage')}</p>
              <div className="flex gap-2" role="group" aria-label={t('linkDialog.messageLanguage')}>
                {(['fr', 'en'] as const).map((l) => (
                  <Tag key={l} active={lang === l} onClick={() => setLang(l)}>
                    {t(`lang.${l}`)}
                  </Tag>
                ))}
              </div>
              <p className="rounded-card border border-bone bg-mist p-3 text-sm text-carbon" lang={lang}>
                {message.replace(created.url, '…')}
              </p>
            </div>
            <Button variant="ghost" onClick={close}>
              {t('linkDialog.done')}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
