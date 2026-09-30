'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, apiBlob } from '../../lib/api';
import { useSession } from '../../lib/session';
import type { DocType, GuestDetail, GuestFields } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { Alert, Button, Dialog, Field, fieldAria, Input, Select, StatusPill } from '../ui';
import { ShareDialog } from '../share/share-dialog';
import { downloadBlob, openBlob } from './share';

const FIELD_ORDER = ['fullName', 'docType', 'docNumber', 'nationality', 'dob', 'docExpiryDate', 'declaredMoroccanNationality', 'entryStampNumber', 'cityOfOrigin', 'nextDestination', 'profession'] as const;
type FieldKey = (typeof FIELD_ORDER)[number];
const TEXT_FIELDS = ['fullName', 'docNumber', 'nationality', 'entryStampNumber', 'cityOfOrigin', 'nextDestination', 'profession'] as const;

/**
 * Owner/Manager: the declared details, corrections, the ID image and the Fiche. Staff never get here (the API
 * would refuse them the fields, the image and the Fiche); they see status on the arrivals list only.
 * Decrypted files live in this tab as object URLs and are revoked when closed.
 */
export function GuestDialog({ guestId, onClose, onChanged }: { guestId: string | null; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations('checkin.guest');
  const tk = useTranslations('checkin');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const ts = useTranslations('share');
  const format = useFormatter();
  const { can } = useSession();
  const [guest, setGuest] = useState<GuestDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [image, setImage] = useState<{ url: string } | 'loading' | null>(null);
  const save = useSubmit();
  const action = useSubmit();
  const open = guestId !== null;

  const load = useCallback(async () => {
    if (!guestId) return;
    try {
      setGuest(await api<GuestDetail>('GET', `/guests/${guestId}`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [guestId]);

  useEffect(() => {
    if (guestId) void load();
    else {
      setGuest(null);
      setEditing(false);
      setNotice(null);
      setImage(null);
    }
  }, [guestId, load]);

  // Revoke the object URL when the image is closed or the dialog goes away.
  useEffect(() => {
    const current = image;
    return () => {
      if (current && typeof current === 'object') URL.revokeObjectURL(current.url);
    };
  }, [image]);

  const date = (iso: string | null) => (iso ? format.dateTime(new Date(iso.slice(0, 10)), { dateStyle: 'medium', timeZone: 'UTC' }) : t('notProvided'));
  const value = (key: FieldKey, f: GuestFields): string => {
    if (key === 'dob' || key === 'docExpiryDate') return date(f[key]);
    if (key === 'docType') return f.docType ? t(`docType.${f.docType}`) : t('notProvided');
    if (key === 'declaredMoroccanNationality') return f.declaredMoroccanNationality ? t('yes') : t('no');
    return f[key] ?? t('notProvided');
  };
  const names = (keys: string[]) => keys.map((k) => ((FIELD_ORDER as readonly string[]).includes(k) ? t(`fields.${k}`) : k)).join(', ');

  function startEdit() {
    const f = guest?.fields;
    if (!f) return;
    setForm({
      fullName: f.fullName ?? '',
      docType: f.docType ?? 'PASSPORT',
      docNumber: f.docNumber ?? '',
      nationality: f.nationality ?? '',
      dob: f.dob ?? '',
      docExpiryDate: f.docExpiryDate ?? '',
      declaredMoroccanNationality: f.declaredMoroccanNationality ? 'yes' : 'no',
      entryStampNumber: f.entryStampNumber ?? '',
      cityOfOrigin: f.cityOfOrigin ?? '',
      nextDestination: f.nextDestination ?? '',
      profession: f.profession ?? '',
    });
    setNotice(null);
    setEditing(true);
  }

  async function saveEdits(e: React.FormEvent) {
    e.preventDefault();
    const original = guest?.fields;
    if (!original) return;
    // Send only what changed; the API validates every field again.
    const body: Record<string, unknown> = {};
    for (const key of TEXT_FIELDS) if ((form[key] ?? '') !== (original[key] ?? '')) body[key] = form[key];
    if (form.docType !== (original.docType ?? 'PASSPORT')) body.docType = form.docType;
    if (form.dob !== (original.dob ?? '')) body.dob = form.dob;
    if (form.docExpiryDate !== (original.docExpiryDate ?? '') && form.docExpiryDate) body.docExpiryDate = form.docExpiryDate;
    if ((form.declaredMoroccanNationality === 'yes') !== original.declaredMoroccanNationality) body.declaredMoroccanNationality = form.declaredMoroccanNationality === 'yes';
    if (Object.keys(body).length === 0) return setEditing(false);
    const updated = await save.run(() => api<GuestDetail>('PATCH', `/guests/${guestId}`, body));
    if (updated) {
      setGuest(updated);
      setEditing(false);
      setNotice(t('saved'));
      onChanged();
    }
  }

  async function verify() {
    const updated = await action.run(() => api<GuestDetail>('PATCH', `/guests/${guestId}`, { verified: true }));
    if (updated) {
      setGuest(updated);
      setNotice(t('verified'));
      onChanged();
    }
  }

  async function showImage() {
    setImage('loading');
    try {
      setImage({ url: URL.createObjectURL(await apiBlob(`/guests/${guestId}/document`)) });
    } catch (e) {
      setImage(null);
      if (e instanceof ApiError && e.status === 404) setGuest((g) => (g ? { ...g, hasDocument: false } : g)); // purged since the list was loaded
      else action.setError(te('generic'));
    }
  }

  async function ficheFile(mode: 'open' | 'download') {
    const blob = await action.run(() => apiBlob(`/guests/${guestId}/fiche`));
    if (!blob) return;
    if (mode === 'open') openBlob(blob, 'fiche-de-police.pdf');
    else downloadBlob(blob, 'fiche-de-police.pdf');
  }

  async function regenerate() {
    setNotice(null);
    if (await action.run(() => api('POST', `/guests/${guestId}/fiche/regenerate`).then(() => true))) {
      setNotice(t('regenerated'));
      await load();
      onChanged();
    }
  }

  const fields = guest?.fields;
  const flagged = guest?.ocr?.flagged ?? [];
  const edited = guest?.ocr?.edited ?? [];

  return (
    <>
      <Dialog open={open} onClose={onClose} title={guest ? t('title', { n: guest.guestIndex ?? 1 }) : t('title', { n: '' })} closeLabel={tc('cancel')}>
        <div className="space-y-4">
          {failed && <Alert>{t('loadFailed')}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}
          {(action.error || save.error) && <Alert>{action.error ?? save.error}</Alert>}

          {guest && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={guest.status === 'VERIFIED' ? 'success' : 'info'}>{tk(`guestStatus.${guest.status}`)}</StatusPill>
                {guest.consent?.at && <p className="text-sm text-slate">{t('consent', { date: format.dateTime(new Date(guest.consent.at), { dateStyle: 'medium' }) })}</p>}
              </div>

              {fields && !editing && (
                <>
                  <h3 className="font-display text-base font-semibold">{t('detailsTitle')}</h3>
                  <dl className="divide-y divide-bone text-sm">
                    {FIELD_ORDER.map((k) => (
                      <div key={k} className="grid gap-0.5 py-2 sm:grid-cols-[12rem_1fr] sm:gap-3">
                        <dt className="text-slate">{t(`fields.${k}`)}</dt>
                        <dd className="font-medium break-words" dir="auto">
                          {value(k, fields)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {edited.length > 0 && <Alert tone="info">{t('edited', { fields: names(edited) })}</Alert>}
                  {flagged.length > 0 && <Alert tone="warning">{t('flagged', { fields: names(flagged) })}</Alert>}
                </>
              )}

              {fields && editing && (
                <form className="space-y-3" onSubmit={saveEdits} noValidate>
                  {TEXT_FIELDS.map((k) => (
                    <Field key={k} id={`g-${k}`} label={t(`fields.${k}`)} error={save.fieldErrors[k]}>
                      <Input {...fieldAria(`g-${k}`, save.fieldErrors[k])} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} dir="auto" />
                    </Field>
                  ))}
                  <Field id="g-docType" label={t('fields.docType')}>
                    <Select id="g-docType" name="g-docType" value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value as DocType })}>
                      {(['PASSPORT', 'CIN'] as const).map((d) => (
                        <option key={d} value={d}>
                          {t(`docType.${d}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field id="g-dob" label={t('fields.dob')} error={save.fieldErrors.dob}>
                    <Input {...fieldAria('g-dob', save.fieldErrors.dob)} type="date" value={form.dob ?? ''} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
                  </Field>
                  <Field id="g-docExpiryDate" label={t('fields.docExpiryDate')} error={save.fieldErrors.docExpiryDate} optional={tc('optional')}>
                    <Input {...fieldAria('g-docExpiryDate', save.fieldErrors.docExpiryDate)} type="date" value={form.docExpiryDate ?? ''} onChange={(e) => setForm({ ...form, docExpiryDate: e.target.value })} />
                  </Field>
                  <Field id="g-moroccan" label={t('fields.declaredMoroccanNationality')}>
                    <Select id="g-moroccan" name="g-moroccan" value={form.declaredMoroccanNationality} onChange={(e) => setForm({ ...form, declaredMoroccanNationality: e.target.value })}>
                      <option value="no">{t('no')}</option>
                      <option value="yes">{t('yes')}</option>
                    </Select>
                  </Field>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button type="submit" disabled={save.pending}>
                      {t('save')}
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(false)}>
                      {t('cancelEdit')}
                    </Button>
                  </div>
                </form>
              )}

              {!editing && (
                <div className="space-y-3 border-t border-bone pt-4">
                  <div className="flex flex-wrap gap-2">
                    {can('guest:write') && (
                      <Button variant="ghost" onClick={startEdit}>
                        {t('edit')}
                      </Button>
                    )}
                    {can('guest:write') && guest.status !== 'VERIFIED' && (
                      <Button variant="ghost" onClick={verify} disabled={action.pending}>
                        {t('verify')}
                      </Button>
                    )}
                  </div>

                  {can('id:read') && (
                    <div className="space-y-2">
                      <Button variant="dark" onClick={showImage} disabled={!guest.hasDocument}>
                        {t('viewId')}
                      </Button>
                      <p className="text-sm text-slate">{guest.hasDocument ? t('idNotice') : t('idMissing')}</p>
                    </div>
                  )}

                  {can('police:read') && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {guest.hasFiche && (
                          <>
                            <Button variant="primary" onClick={() => ficheFile('open')} disabled={action.pending}>
                              {t('openFiche')}
                            </Button>
                            <Button variant="ghost" onClick={() => ficheFile('download')} disabled={action.pending}>
                              {t('downloadFiche')}
                            </Button>
                            {can('share:manage') && (
                              <Button variant="ghost" onClick={() => setSharing(true)}>
                                {t('shareFiche')}
                              </Button>
                            )}
                          </>
                        )}
                        <Button variant="ghost" onClick={regenerate} disabled={action.pending}>
                          {t('regenerate')}
                        </Button>
                      </div>
                      <p className="text-sm text-slate">{guest.hasFiche ? t('ficheNote') : t('noFiche')}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Dialog>

      <ShareDialog target={sharing && guestId ? { type: 'FICHE_DE_POLICE', guestId } : null} title={ts('dialog.titleFiche')} onClose={() => setSharing(false)} />

      {/* The ID image, in its own dialog. The object URL is revoked as soon as it closes. */}
      <Dialog open={image !== null} onClose={() => setImage(null)} title={t('viewId')} closeLabel={t('closeImage')}>
        <div className="space-y-3">
          <p className="text-sm text-slate">{t('idNotice')}</p>
          {image === 'loading' && <p className="text-sm text-slate">{t('idLoading')}</p>}
          {image && typeof image === 'object' && (
            // A plain <img>: this is a short-lived blob URL of a protected file, not a static asset.
            <img src={image.url} alt={t('idAlt')} className="max-h-[70dvh] w-full rounded-image border border-bone object-contain" />
          )}
        </div>
      </Dialog>
    </>
  );
}
