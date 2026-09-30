'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { normalizePhone } from '../../lib/phone';
import type { NotificationPrefs, PreferredChannel } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { Alert, Button, Card, Field, fieldAria, Input, Select } from '../ui';

const CHANNELS: PreferredChannel[] = ['EMAIL', 'WHATSAPP', 'BOTH', 'NONE'];
/** next-intl reads a dot in a key as nesting, so the alert types are looked up with an underscore. */
const alertKey = (alertType: string) => `alert_${alertType.replace('.', '_')}` as 'alert_day_counter_amber' | 'alert_day_counter_red';

/**
 * How the signed-in user is told about the night counter, and the WhatsApp number used for it. The number is shown
 * masked and never comes back in full. WhatsApp choices are offered only when the API says it is ready.
 */
export function NotificationsScreen() {
  const t = useTranslations('notifications');
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const savePhone = useSubmit();
  const choose = useSubmit();

  const load = useCallback(async () => {
    try {
      setPrefs(await api<NotificationPrefs>('GET', '/me/notification-preferences'));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function onSavePhone(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    const valid = normalizePhone(phone);
    if (!valid) return setPhoneError(t('phoneHint'));
    setPhoneError(undefined);
    const next = await savePhone.run(() => api<NotificationPrefs>('PUT', '/me/phone', { phone: valid }));
    if (next) {
      setPrefs(next);
      setPhone(''); // the field never keeps a number the server has already taken
      setNotice(t('phoneSaved'));
    }
  }

  async function onRemovePhone() {
    setNotice(null);
    const next = await savePhone.run(() => api<NotificationPrefs>('PUT', '/me/phone', { phone: null }));
    if (next) {
      setPrefs(next);
      setNotice(t('phoneRemoved'));
    }
  }

  async function onChoose(alertType: string, channel: PreferredChannel) {
    setNotice(null);
    const next = await choose.run(() => api<NotificationPrefs>('PUT', '/me/notification-preferences', { alertType, channel }));
    if (next) {
      setPrefs(next);
      setNotice(t('saved'));
    } else await load();
  }

  const whatsappOk = !!prefs?.whatsapp.ready && !!prefs.phone;

  return (
    <section className="space-y-6">
      <div>
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate">{t('intro')}</p>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {failed && <Alert>{t('loadFailed')}</Alert>}
      {prefs && !prefs.whatsapp.ready && <Alert tone="info">{t('notReady')}</Alert>}

      {prefs && (
        <Card className="space-y-4">
          <form onSubmit={onSavePhone} className="space-y-4" noValidate>
            <Field id="phone" label={t('phone')} hint={t('phoneHint')} error={phoneError ?? savePhone.fieldErrors.phone}>
              <Input {...fieldAria('phone', phoneError ?? savePhone.fieldErrors.phone, t('phoneHint'))} type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} className="max-w-72" dir="ltr" />
            </Field>
            {prefs.phone && <p className="text-sm text-slate">{t('phoneCurrent', { phone: prefs.phone })}</p>}
            {savePhone.error && <Alert>{savePhone.error}</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={savePhone.pending || phone.trim() === ''}>
                {t('savePhone')}
              </Button>
              {prefs.phone && (
                <Button variant="danger" onClick={() => void onRemovePhone()} disabled={savePhone.pending}>
                  {t('removePhone')}
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      {prefs && (
        <Card className="space-y-4">
          <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('alerts')}</h2>
          {choose.error && <Alert>{choose.error}</Alert>}
          <div className="grid gap-4">
            {prefs.preferences.map((p) => (
              <Field key={p.alertType} id={`pref-${p.alertType}`} label={t(alertKey(p.alertType))}>
                <Select {...fieldAria(`pref-${p.alertType}`)} aria-label={`${t(alertKey(p.alertType))}: ${t('channel')}`} value={p.channel} disabled={choose.pending} onChange={(e) => void onChoose(p.alertType, e.target.value as PreferredChannel)} className="max-w-80">
                  {CHANNELS.filter((c) => whatsappOk || (c !== 'WHATSAPP' && c !== 'BOTH') || p.channel === c).map((c) => (
                    <option key={c} value={c}>
                      {t(c)}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <p className="text-sm text-slate">{t('urgentNote')}</p>
        </Card>
      )}
    </section>
  );
}
