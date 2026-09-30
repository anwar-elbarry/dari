'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api, apiBlob } from '../../lib/api';
import { useSession } from '../../lib/session';
import type { Checklist, ChecklistItem, ChecklistStatus, PropertyReduced } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';
import { Alert, Button, Card, Field, fieldAria, Input, Select, StatusPill, Textarea } from '../ui';

const STATUSES: ChecklistStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'NOT_APPLICABLE'];
const TONE: Record<ChecklistStatus, 'neutral' | 'info' | 'success'> = { TODO: 'neutral', IN_PROGRESS: 'info', DONE: 'success', NOT_APPLICABLE: 'neutral' };
const MAX_FILE = 8 * 1024 * 1024;

/**
 * The licensing checklist of one property. The steps come from the list counsel validated (or, until then, a list
 * labelled as not validated); the screen never writes a step itself. Owner/Manager edit; Staff see the steps and their
 * status only, which is all the API sends them. A document is fetched as a blob only when asked for and downloaded.
 */
export function ChecklistScreen({ propertyId }: { propertyId: string }) {
  const t = useTranslations('checklist');
  const locale = useLocale();
  const { can } = useSession();
  const [property, setProperty] = useState<PropertyReduced | null>(null);
  const [list, setList] = useState<Checklist | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const status = useSubmit();
  const canWrite = can('checklist:write');

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api<PropertyReduced>('GET', `/properties/${propertyId}`), api<Checklist>('GET', `/properties/${propertyId}/checklist`)]);
      setProperty(p);
      setList(c);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [propertyId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(item: ChecklistItem, value: ChecklistStatus) {
    setNotice(null);
    await status.run(() => api('PATCH', `/properties/${propertyId}/checklist/${item.id}`, { status: value }));
    await load();
  }

  const name = (i: ChecklistItem) => (locale === 'fr' ? i.nameFr : i.nameEn);
  const pct = list && list.progress.total > 0 ? Math.round((list.progress.done / list.progress.total) * 100) : 0;

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Link href={`/properties/${propertyId}`} className="text-sm font-medium text-link hover:underline">
          ← {t('back')}
        </Link>
        <h1 className="font-display text-2xl leading-[1.33] font-bold tracking-[-0.02em]">{t('title')}</h1>
        <p className="text-sm text-slate">
          {property ? `${property.name} · ` : ''}
          {t('intro')}
        </p>
        {!canWrite && <Alert tone="info">{t('staffNote')}</Alert>}
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {status.error && <Alert>{status.error}</Alert>}
      {failed && <Alert>{t('loadFailed')}</Alert>}

      {list && !list.covered && <Alert tone="info">{t('notCovered')}</Alert>}
      {list && list.covered && !list.validated && <Alert tone="warning">{t('notValidated')}</Alert>}

      {list && list.covered && (
        <Card className="space-y-3">
          <p className="font-display text-lg font-semibold">{t('progress', { done: list.progress.done, total: list.progress.total })}</p>
          <div className="h-2 overflow-hidden rounded-pill bg-mercury" role="progressbar" aria-valuemin={0} aria-valuemax={list.progress.total} aria-valuenow={list.progress.done} aria-label={t('progress', { done: list.progress.done, total: list.progress.total })}>
            <div className="h-full rounded-pill bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </Card>
      )}

      {list && list.items.length > 0 && (
        <ul className="space-y-3">
          {list.items.map((item) => (
            <li key={item.id}>
              <Card className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{name(item)}</p>
                    {item.condition && <p className="text-sm text-slate">{t('condition', { condition: item.condition })}</p>}
                    {canWrite && item.dueDate && <p className="text-sm text-slate">{t('due')}: {item.dueDate}</p>}
                  </div>
                  {canWrite ? (
                    <Select aria-label={t('statusFor', { step: name(item) })} value={item.status} disabled={status.pending} onChange={(e) => void setStatus(item, e.target.value as ChecklistStatus)} className="w-auto min-w-40">
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(s)}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <StatusPill tone={TONE[item.status]}>{t(item.status)}</StatusPill>
                  )}
                </div>
                {canWrite && (
                  <div>
                    <Button variant="ghost" aria-expanded={open === item.id} onClick={() => setOpen(open === item.id ? null : item.id)}>
                      {t('edit')}
                    </Button>
                    {item.hasDocument && <span className="ms-2 text-sm text-slate">{t('document')}</span>}
                  </div>
                )}
                {canWrite && open === item.id && <ItemEditor propertyId={propertyId} item={item} onSaved={(message) => { setNotice(message); void load(); }} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ItemEditor({ propertyId, item, onSaved }: { propertyId: string; item: ChecklistItem; onSaved: (message: string) => void }) {
  const t = useTranslations('checklist');
  const save = useSubmit();
  const doc = useSubmit();
  const [due, setDue] = useState(item.dueDate ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const base = `/properties/${propertyId}/checklist/${item.id}`;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (await save.run(() => api('PATCH', base, { dueDate: due === '' ? null : due, note: note.trim() === '' ? null : note.trim() }))) onSaved(t('saved'));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE) return doc.setError(t('fileHint'));
    const form = new FormData();
    form.append('file', file);
    if (await doc.run(() => api('POST', `${base}/document`, form).then(() => true))) onSaved(t('attached'));
  }

  /** The decrypted bytes exist in this tab only for the moment of the download. */
  async function download() {
    const blob = await doc.run(() => apiBlob(`${base}/document`));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = blob.type === 'application/pdf' ? 'document.pdf' : 'document.jpg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function remove() {
    if (await doc.run(() => api('DELETE', `${base}/document`).then(() => true))) onSaved(t('removed'));
  }

  return (
    <div className="space-y-5 border-t border-bone pt-4">
      <form onSubmit={onSave} className="space-y-4" noValidate>
        <Field id={`due-${item.id}`} label={t('due')} error={save.fieldErrors.dueDate}>
          <Input {...fieldAria(`due-${item.id}`, save.fieldErrors.dueDate)} type="date" value={due} onChange={(e) => setDue(e.target.value)} className="max-w-48" />
        </Field>
        <Field id={`note-${item.id}`} label={t('note')} hint={t('noteHint')} error={save.fieldErrors.note}>
          <Textarea {...fieldAria(`note-${item.id}`, save.fieldErrors.note, t('noteHint'))} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {save.error && <Alert>{save.error}</Alert>}
        <Button type="submit" disabled={save.pending}>
          {t('save')}
        </Button>
      </form>

      <div className="space-y-3">
        <p className="text-sm font-medium">{t('document')}</p>
        {!item.hasDocument && <p className="text-sm text-slate">{t('noDocument')}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-pill border border-bone px-5 font-display text-sm font-bold text-ink hover:bg-mercury has-[:focus-visible]:shadow-[var(--shadow-focus)]">
            {item.hasDocument ? t('replace') : t('attach')}
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={onFile} disabled={doc.pending} />
          </label>
          {item.hasDocument && (
            <>
              <Button variant="dark" onClick={() => void download()} disabled={doc.pending}>
                {t('open_document')}
              </Button>
              <Button variant="danger" onClick={() => void remove()} disabled={doc.pending}>
                {t('remove')}
              </Button>
            </>
          )}
        </div>
        <p className="text-sm text-slate">{t('fileHint')}</p>
        {doc.error && <Alert>{doc.error}</Alert>}
      </div>
    </div>
  );
}
