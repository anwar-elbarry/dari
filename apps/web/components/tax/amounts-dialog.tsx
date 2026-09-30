'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { AMOUNT_FIELDS, AmountsForm, buildAmountsBody, toInputText } from '../../lib/amount-validation';
import { api } from '../../lib/api';
import type { StayAmounts } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { Alert, Button, Dialog, Field, fieldAria, Input } from '../ui';

export interface AmountsTarget {
  bookingId: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
}

const FIELDS = [...AMOUNT_FIELDS, 'partySize'] as const;
const day = (iso: string) => iso.slice(0, 10);

/**
 * The money figures and the party size of one stay (Owner/Manager). Amounts stay text from the input to the
 * request ("1234.50"): they are checked with the same rule as the API and never turned into a number.
 */
export function AmountsDialog({ target, onClose, onSaved }: { target: AmountsTarget | null; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('tax.amounts');
  const tc = useTranslations('common');
  const format = useFormatter();
  const fmt = (iso: string) => format.dateTime(new Date(day(iso)), { dateStyle: 'medium', timeZone: 'UTC' });
  return (
    <Dialog open={target !== null} onClose={onClose} title={t('title')} closeLabel={tc('cancel')}>
      {target && (
        <div className="space-y-4">
          <p className="text-sm font-medium tabular-nums">{t('stay', { checkIn: fmt(target.checkIn), checkOut: fmt(target.checkOut) })}</p>
          <AmountsFormBody key={target.bookingId} target={target} onClose={onClose} onSaved={onSaved} />
        </div>
      )}
    </Dialog>
  );
}

function AmountsFormBody({ target, onClose, onSaved }: { target: AmountsTarget; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('tax.amounts');
  const tc = useTranslations('common');
  const [form, setForm] = useState<AmountsForm | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof AmountsForm, 'invalid'>>>({});
  const save = useSubmit();

  // The stay is read through the property's list (Owner/Manager receive the revenue fields there), narrowed to its check-in day.
  useEffect(() => {
    let cancelled = false;
    const d = day(target.checkIn);
    api<StayAmounts[]>('GET', `/properties/${target.propertyId}/bookings?from=${d}&to=${d}`)
      .then((stays) => {
        const stay = stays.find((s) => s.id === target.bookingId);
        if (cancelled) return;
        if (!stay) return setLoadFailed(true);
        setForm(Object.fromEntries(FIELDS.map((f) => [f, toInputText(stay[f])])) as AmountsForm);
      })
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (loadFailed) return <Alert>{t('loadFailed')}</Alert>;
  if (!form) return <p className="text-sm text-slate">{t('loading')}</p>;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const built = buildAmountsBody(form!);
    setErrors(built.ok ? {} : built.errors);
    if (!built.ok) return;
    if ((await save.run(() => api('PATCH', `/bookings/${target.bookingId}/amounts`, built.body).then(() => true))) === true) onSaved();
  }

  const set = (field: keyof AmountsForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f!, [field]: e.target.value }));
  const errorOf = (field: keyof AmountsForm) => (errors[field] || save.fieldErrors[field] ? (field === 'partySize' ? t('invalidParty') : t('invalid')) : undefined);
  const hintOf = (field: keyof AmountsForm) => (t.has(`hint.${field}`) ? t(`hint.${field}`) : undefined);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-slate">{t('intro')}</p>
      {save.error && <Alert>{save.error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const id = `amount-${field}`;
          return (
            <Field key={field} id={id} label={t(`field.${field}`)} hint={hintOf(field)} error={errorOf(field)}>
              <Input {...fieldAria(id, errorOf(field), hintOf(field))} value={form[field]} onChange={set(field)} inputMode={field === 'partySize' ? 'numeric' : 'decimal'} autoComplete="off" />
            </Field>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.pending}>
          {save.pending ? t('saving') : t('save')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}
