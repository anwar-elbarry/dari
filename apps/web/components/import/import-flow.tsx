'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Alert, Button, Card, Field, fieldAria, Input, Select } from '../ui';
import { api, ApiError } from '../../lib/api';
import type { ImportPreview, ImportResult } from '../../lib/types';
import { useSubmit } from '../../lib/use-submit';

const FIELDS = ['check_in', 'check_out', 'platform', 'confirmation_code', 'party_size', 'nightly_revenue', 'cleaning_fee', 'addon_revenue', 'discounts', 'refunds', 'platform_commission', 'taxe_sejour_amount'] as const;

/** Upload → check (nothing is saved) → confirm. Guest names and emails in the file are never read. */
export function ImportFlow({ propertyId, onDone }: { propertyId: string; onDone: () => void }) {
  const t = useTranslations('import');
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const check = useSubmit();
  const commit = useSubmit();

  const body = (withMapping: Record<string, string> | null) => {
    const file = fileRef.current?.files?.[0];
    if (!file) return null;
    const form = new FormData();
    form.append('file', file);
    if (withMapping) form.append('mapping', JSON.stringify(withMapping));
    return form;
  };

  const explain = (e: unknown) => (e instanceof ApiError && t.has(`errors.${e.code}`) ? t(`errors.${e.code}`) : null);

  async function runPreview(m: Record<string, string> | null) {
    const form = body(m);
    if (!form) return;
    setMessage(null);
    setResult(null);
    try {
      const p = await api<ImportPreview>('POST', `/properties/${propertyId}/imports/preview`, form);
      setPreview(p);
      setMapping(p.mapping);
    } catch (e) {
      setPreview(null);
      const known = explain(e);
      if (known) setMessage(known);
      else await check.run(() => Promise.reject(e));
    }
  }

  async function onCheck(e: React.FormEvent) {
    e.preventDefault();
    await runPreview(null);
  }

  async function onCommit() {
    const form = body(mapping);
    if (!form) return;
    const r = await commit.run(() => api<ImportResult>('POST', `/properties/${propertyId}/imports`, form));
    if (r) {
      setResult(r);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      onDone();
    }
  }

  const mappedFields = new Set(Object.values(mapping));
  const requiredMissing = !mappedFields.has('check_in') || !mappedFields.has('check_out');
  const fresh = preview ? preview.validRows - preview.alreadyImported : 0;

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <p className="text-sm text-slate">{t('intro')}</p>
        <a href="/api/imports/template.csv" download className="inline-block text-sm font-semibold text-link hover:underline">
          {t('template')}
        </a>
        <form onSubmit={onCheck} className="space-y-4">
          {check.error && <Alert>{check.error}</Alert>}
          {message && <Alert>{message}</Alert>}
          <Field id="file" label={t('file')} hint={t('fileHelp')} error={check.fieldErrors.file}>
            <Input {...fieldAria('file', check.fieldErrors.file, t('fileHelp'))} ref={fileRef} type="file" accept=".csv,text/csv" required className="py-2" />
          </Field>
          <Button type="submit" disabled={check.pending}>
            {t('preview')}
          </Button>
        </form>
      </Card>

      {result && (
        <Alert tone="success">
          {t('done', { imported: result.imported, existing: result.skippedExisting, errors: result.skippedWithErrors })}
        </Alert>
      )}

      {preview && (
        <Card className="space-y-6">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{t('mapping')}</h2>
            <p className="mt-1 text-sm text-slate">{t('mappingHelp')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {preview.headers.map((h, i) => (
              <Field key={h + i} id={`map-${i}`} label={h}>
                <Select
                  {...fieldAria(`map-${i}`)}
                  value={mapping[h] ?? ''}
                  onChange={(e) => {
                    const next = { ...mapping };
                    // A field can be used by one column only: moving it clears its previous column.
                    for (const k of Object.keys(next)) if (e.target.value && next[k] === e.target.value) delete next[k];
                    if (e.target.value) next[h] = e.target.value;
                    else delete next[h];
                    setMapping(next);
                  }}
                >
                  <option value="">{t('ignore')}</option>
                  {FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {t(`fields.${f}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <Button variant="ghost" onClick={() => runPreview(mapping)} disabled={check.pending || requiredMissing}>
            {t('preview')}
          </Button>
          {requiredMissing && <Alert>{t('errors.MAPPING_INCOMPLETE')}</Alert>}

          <p className="font-medium">{t('summary', { valid: preview.validRows, total: preview.totalRows, existing: preview.alreadyImported })}</p>

          {preview.errorCount > 0 && (
            <div className="space-y-2">
              <h3 className="font-display text-lg font-semibold tracking-[-0.02em]">{t('errorsTitle')}</h3>
              <ul className="divide-y divide-bone rounded-card border border-bone text-sm">
                {preview.errors.map((er, i) => (
                  <li key={i} className="flex flex-wrap gap-x-3 px-4 py-2">
                    <span className="font-mono text-xs tracking-[0.06em] text-slate uppercase">{t('line', { line: er.line })}</span>
                    <span>
                      {er.field ? `${t(`fields.${er.field as (typeof FIELDS)[number]}`)} — ` : ''}
                      {t(`codes.${er.code}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.preview.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-display text-lg font-semibold tracking-[-0.02em]">{t('previewTitle')}</h3>
              <ul className="divide-y divide-bone rounded-card border border-bone text-sm tabular-nums">
                {preview.preview.map((r) => (
                  <li key={r.line} className="flex flex-wrap gap-x-4 px-4 py-2">
                    <span>
                      {r.checkIn} → {r.checkOut}
                    </span>
                    <span className="text-slate">{r.platform}</span>
                    {r.confirmationCode && <span className="font-mono text-xs tracking-[0.06em] text-slate uppercase">{r.confirmationCode}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {commit.error && <Alert>{commit.error}</Alert>}
          <Button onClick={onCommit} disabled={commit.pending || requiredMissing || fresh === 0}>
            {t('commit', { count: fresh })}
          </Button>
        </Card>
      )}
    </div>
  );
}
