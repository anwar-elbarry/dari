'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { countryOptions, normalizeNationality } from '../../lib/countries';
import { CheckinView, FormField, guestApi, SubmitResult, UploadResult } from '../../lib/guest-api';
import { ImageProblem, prepareImage } from '../../lib/guest-image';
import { DocChoice, DocumentDrawing } from './document-drawing';
import { clean, entryStampRequired, GuestForm, validate } from '../../lib/guest-validation';
import { Alert, Button, Card, Field, fieldAria, Input, Select, StatusPill } from '../ui';

type Step = 'loading' | 'unavailable' | 'temporary' | 'intro' | 'photo' | 'form' | 'done';

const KEY_TOKEN = 'dari.checkin.token';
const KEY_DRAFT = 'dari.checkin.draft';
const EMPTY: GuestForm = { docType: 'PASSPORT', fullName: '', nationality: '', docNumber: '', dob: '', docExpiryDate: '', declaredMoroccanNationality: '', entryStampNumber: '', cityOfOrigin: '', nextDestination: '', profession: '' };

/** sessionStorage can be unavailable (private mode, blocked): the flow then simply does not survive a reload. */
const store = {
  get: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
  del: (k: string) => {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

/**
 * The link carries its token in the URL fragment (`/checkin#token=…`): a fragment is never sent to any server, so it
 * is in no access log and no link-preview request. It is read once, removed from the address bar and history entry,
 * and kept only for this tab's session. From here on it travels in a request header, never in a URL.
 */
function readToken(): string | null {
  // Fragment only: a token in the query string would already have reached a server and its logs.
  const found = /[#&?]token=([A-Za-z0-9_-]{43})/.exec(window.location.hash);
  if (found) {
    window.history.replaceState(null, '', window.location.pathname);
    store.set(KEY_TOKEN, found[1]);
    store.del(KEY_DRAFT); // a new link starts a new form
    return found[1];
  }
  return store.get(KEY_TOKEN);
}

export function CheckinFlow() {
  const t = useTranslations('guest');
  const tf = useTranslations('guest.form');
  const tc = useTranslations('common');
  const locale = useLocale();
  const format = useFormatter();
  const token = useRef<string | null>(null);
  const takeInput = useRef<HTMLInputElement>(null);
  const chooseInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('loading');
  const [view, setView] = useState<CheckinView | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [form, setForm] = useState<GuestForm>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof GuestForm | 'consent', string>>>({});
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState<null | 'preparing' | 'reading' | 'sending'>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<SubmitResult | null>(null);
  /** Which document the guest said they will photograph: decides the instructions and prefills the type. */
  const [doc, setDoc] = useState<DocChoice | null>(null);

  const countries = useMemo(() => countryOptions(locale), [locale]);
  const day = (iso: string) => format.dateTime(new Date(iso.slice(0, 10)), { dateStyle: 'medium', timeZone: 'UTC' });

  const errorText = useCallback((e: unknown) => (e instanceof ApiError && t.has(`errors.${e.code}`) ? t(`errors.${e.code}`) : t('errors.generic')), [t]);

  /** Loads (or reloads, when the language changes) what the guest is shown: stay, consent text in their language. */
  const load = useCallback(async () => {
    if (!token.current) return setStep('unavailable');
    try {
      const v = await guestApi<CheckinView>('GET', `?lang=${locale}`, token.current);
      setView(v);
      setConsented(false); // the wording is per language: a new text needs a new confirmation
      setStep((s) => (s === 'loading' || s === 'temporary' ? (store.get(KEY_DRAFT) ? 'photo' : 'intro') : s));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        store.del(KEY_TOKEN);
        store.del(KEY_DRAFT);
        setStep('unavailable');
      } else if (e instanceof ApiError && e.status === 503) setStep('temporary');
      else {
        setProblem(errorText(e));
        setStep('temporary');
      }
    }
  }, [locale, errorText]);

  useEffect(() => {
    token.current ??= readToken();
    setDraftId(store.get(KEY_DRAFT));
    void load();
  }, [load]);

  function fill(u: UploadResult) {
    const s = u.ocr.suggestion;
    setForm((f) => ({
      ...f,
      docType: s.docType === 'CIN' ? 'CIN' : s.docType === 'PASSPORT' ? 'PASSPORT' : f.docType,
      fullName: s.fullName ?? f.fullName,
      nationality: normalizeNationality(s.nationality) || f.nationality,
      docNumber: s.docNumber ?? f.docNumber,
      dob: s.dob ?? f.dob,
      docExpiryDate: s.docExpiryDate ?? f.docExpiryDate,
    }));
  }

  async function onFile(file: File | undefined) {
    if (!file || !token.current) return;
    setProblem(null);
    setBusy('preparing');
    try {
      const blob = await prepareImage(file);
      setBusy('reading');
      const body = new FormData();
      body.append('file', blob, 'document.jpg');
      if (draftId) body.append('draftId', draftId);
      const result = await guestApi<UploadResult>('POST', '/document', token.current, body);
      setDraftId(result.draftId);
      store.set(KEY_DRAFT, result.draftId);
      setUpload(result);
      fill(result);
      setStep('form');
    } catch (e) {
      if (e instanceof ImageProblem) setProblem(t(`errors.${e.code}`));
      else if (e instanceof ApiError && e.code === 'LINK_UNAVAILABLE') {
        store.del(KEY_TOKEN);
        setStep('unavailable');
      } else if (e instanceof ApiError && e.code === 'DRAFT_NOT_FOUND') {
        store.del(KEY_DRAFT);
        setDraftId(null);
        setProblem(errorText(e));
      } else setProblem(errorText(e));
    } finally {
      setBusy(null);
      if (takeInput.current) takeInput.current.value = '';
      if (chooseInput.current) chooseInput.current.value = '';
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.current || !view || !draftId) return;
    setProblem(null);
    const found = validate(form, new Date(), view.entryStampExemption);
    const stampNeeded = entryStampRequired(view.entryStampExemption, form);
    const next: Partial<Record<keyof GuestForm | 'consent', string>> = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, tf(v as 'required' | 'invalid')]));
    if (!consented) next.consent = tf('required');
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      setProblem(tf('fixErrors'));
      document.getElementById(first === 'consent' ? 'f-consent' : first === 'declaredMoroccanNationality' ? 'f-moroccan-yes' : `f-${first}`)?.focus();
      return;
    }
    setBusy('sending');
    try {
      const result = await guestApi<SubmitResult>('POST', '/submit', token.current, {
        draftId,
        consentTextId: view.consent.id,
        consent: true,
        docType: form.docType,
        fullName: clean(form.fullName),
        nationality: form.nationality,
        docNumber: clean(form.docNumber),
        dob: form.dob,
        ...(form.docExpiryDate ? { docExpiryDate: form.docExpiryDate } : {}),
        declaredMoroccanNationality: form.declaredMoroccanNationality === 'yes',
        ...(stampNeeded ? { entryStampNumber: clean(form.entryStampNumber) } : {}),
        cityOfOrigin: clean(form.cityOfOrigin),
        nextDestination: clean(form.nextDestination),
        profession: clean(form.profession),
      });
      store.del(KEY_DRAFT);
      if (!result.canAddGuest) store.del(KEY_TOKEN);
      setDone(result);
      setStep('done');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404 && err.code === 'LINK_UNAVAILABLE') {
        store.del(KEY_TOKEN);
        setStep('unavailable');
      } else {
        if (err instanceof ApiError && err.details?.length) setErrors(Object.fromEntries(err.details.map((d) => [d.field, tf('invalid')])));
        setProblem(errorText(err));
      }
    } finally {
      setBusy(null);
    }
  }

  function another() {
    setForm(EMPTY);
    setDoc(null);
    setUpload(null);
    setDraftId(null);
    setErrors({});
    setConsented(false);
    setDone(null);
    setStep('photo');
    void load();
  }

  const set = (k: keyof GuestForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const flagged = new Set<FormField>(upload ? [...upload.ocr.flagged] : []);
  const hint = (k: FormField) => (flagged.has(k) && upload?.ocr.status !== 'no_mrz' && upload?.ocr.status !== 'unavailable' ? tf('check') : undefined);
  const checkTag = (k: FormField) => (hint(k) ? <StatusPill tone="warning">{tf('checkTag')}</StatusPill> : null);

  if (step === 'loading') return <p className="text-sm text-slate">{t('loading')}</p>;

  if (step === 'unavailable' || step === 'temporary') {
    const key = step === 'unavailable' ? 'unavailable' : 'temporary';
    return (
      <Card className="space-y-3">
        <h1 className="font-display text-2xl leading-[1.3] font-bold tracking-[-0.02em]">{t(`${key}.title`)}</h1>
        <p className="text-slate">{t(`${key}.body`)}</p>
        {problem && step === 'temporary' && <Alert>{problem}</Alert>}
        {step === 'temporary' && (
          <Button
            variant="ghost"
            onClick={() => {
              setProblem(null);
              setStep('loading');
              void load();
            }}
          >
            {t('retry')}
          </Button>
        )}
      </Card>
    );
  }

  if (step === 'intro' && view) {
    return (
      <Card className="space-y-5">
        <div>
          <h1 className="font-display text-2xl leading-[1.3] font-bold tracking-[-0.02em]">{t('intro.title')}</h1>
          <p className="mt-2 font-medium">{t('intro.stay', { property: view.property.name })}</p>
          <p className="text-sm text-slate tabular-nums">{t('intro.dates', { checkIn: day(view.stay.checkIn), checkOut: day(view.stay.checkOut) })}</p>
        </div>
        <ol className="list-decimal space-y-1.5 ps-5 text-sm">
          {(t.raw('intro.steps') as string[]).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="text-sm text-slate">
          {t('intro.time')} {t('intro.guestsLeft', { remaining: view.guests.remaining })}
        </p>
        <p className="rounded-card border border-bone bg-mist p-3 text-sm text-carbon">{t('intro.privacy')}</p>
        <Button className="w-full" onClick={() => setStep('photo')}>
          {t('intro.start')}
        </Button>
      </Card>
    );
  }

  function chooseDoc(d: DocChoice) {
    setDoc(d);
    setForm((f) => ({ ...f, docType: d }));
  }

  if (step === 'photo' && view) {
    const left = upload ? upload.uploadsLeft : view.limits.maxUploadsPerGuest;
    return (
      <Card className="space-y-5">
        <h1 className="font-display text-2xl leading-[1.3] font-bold tracking-[-0.02em]">{t('photo.title')}</h1>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('photo.which')}</legend>
          {(['PASSPORT', 'CIN'] as const).map((d) => (
            <label key={d} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-card border px-4 py-3 ${doc === d ? 'border-brand-100 bg-brand-50' : 'border-bone bg-mist'}`}>
              <input type="radio" name="doc" value={d} checked={doc === d} onChange={() => chooseDoc(d)} className="size-4 flex-none accent-[var(--link)]" data-testid={`doc-${d}`} />
              <span>
                <span className={`block font-display text-sm font-bold ${doc === d ? 'text-link' : 'text-ink'}`}>{t(`photo.docs.${d}.label`)}</span>
                <span className="block text-sm text-slate">{t(`photo.docs.${d}.hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {doc && (
          <div className="space-y-4">
            <DocumentDrawing kind={doc} label={t(`photo.drawing.${doc}`)} />
            <p className="text-sm font-medium">{t(`photo.howTo.${doc}`)}</p>
            <ul className="list-disc space-y-1.5 ps-5 text-sm">
              {(t.raw('photo.tips') as string[]).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {problem && <Alert>{problem}</Alert>}
        {busy && <Alert tone="info">{busy === 'preparing' ? t('photo.preparing') : t('photo.reading')}</Alert>}
        {/* Two inputs: the camera directly, or a file already on the phone. Both feed the same resize and upload. */}
        <input ref={takeInput} type="file" accept="image/*" capture="environment" hidden data-testid="take-photo" onChange={(e) => void onFile(e.target.files?.[0])} />
        <input ref={chooseInput} type="file" accept="image/*" hidden data-testid="choose-photo" onChange={(e) => void onFile(e.target.files?.[0])} />
        {doc && (
          <div className="grid gap-3">
            <Button className="w-full" onClick={() => takeInput.current?.click()} disabled={busy !== null}>
              {t('photo.take')}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => chooseInput.current?.click()} disabled={busy !== null}>
              {t('photo.choose')}
            </Button>
          </div>
        )}
        <p className="text-center text-xs text-slate">{left > 0 ? t('photo.left', { count: left }) : t('photo.noneLeft')}</p>
      </Card>
    );
  }

  if (step === 'form' && view && upload) {
    const status = upload.ocr.status;
    // Hidden only when counsel's validated exemption covers this guest. Until then a Moroccan guest gets a hint instead.
    const stampNeeded = entryStampRequired(view.entryStampExemption, form);
    const stampHint = form.nationality === 'MAR' || form.declaredMoroccanNationality === 'yes' ? tf('entryStampHintMoroccan') : tf('entryStampHint');
    const readTone = status === 'ok' ? 'success' : status === 'partial' ? 'warning' : 'info';
    const readText = status === 'ok' ? t('read.ok') : status === 'partial' ? t('read.partial') : t('read.none');
    return (
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <Card className="space-y-4">
          <div>
            <h1 className="font-display text-2xl leading-[1.3] font-bold tracking-[-0.02em]">{tf('title')}</h1>
            <p className="mt-1 text-sm text-slate">{tf('intro')}</p>
          </div>
          <Alert tone={readTone}>{readText}</Alert>
          {status === 'no_mrz' && doc && upload.uploadsLeft > 0 && <p className="text-sm text-carbon">{t(`read.noneHint.${doc}`)}</p>}
          {upload.ocr.quality?.blurry && <Alert tone="warning">{t('read.blurry')}</Alert>}
          {upload.ocr.quality?.lowContrast && <Alert tone="warning">{t('read.lowContrast')}</Alert>}
          {upload.uploadsLeft > 0 && (
            <Button variant="ghost" onClick={() => setStep('photo')}>
              {t('read.retake')}
            </Button>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="font-display text-lg font-semibold">{tf('documentSection')}</h2>
          <Field id="f-docType" label={tf('docType')}>
            <Select id="f-docType" name="docType" value={form.docType} onChange={set('docType')}>
              {(['PASSPORT', 'CIN'] as const).map((d) => (
                <option key={d} value={d}>
                  {tf(`docTypes.${d}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="f-fullName" label={tf('fullName')} hint={hint('fullName') ?? tf('fullNameHint')} error={errors.fullName}>
            <Input {...fieldAria('f-fullName', errors.fullName, tf('fullNameHint'))} autoComplete="name" dir="auto" value={form.fullName} onChange={set('fullName')} />
            {checkTag('fullName')}
          </Field>
          <Field id="f-nationality" label={tf('nationality')} hint={hint('nationality')} error={errors.nationality}>
            <Select {...fieldAria('f-nationality', errors.nationality)} value={form.nationality} onChange={set('nationality')}>
              <option value="">{tf('country')}</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
            {checkTag('nationality')}
          </Field>
          <Field id="f-docNumber" label={tf('docNumber')} hint={hint('docNumber')} error={errors.docNumber}>
            <Input {...fieldAria('f-docNumber', errors.docNumber)} autoCapitalize="characters" autoComplete="off" spellCheck={false} value={form.docNumber} onChange={set('docNumber')} />
            {checkTag('docNumber')}
          </Field>
          <Field id="f-dob" label={tf('dob')} hint={hint('dob')} error={errors.dob}>
            <Input {...fieldAria('f-dob', errors.dob)} type="date" autoComplete="bday" value={form.dob} onChange={set('dob')} />
            {checkTag('dob')}
          </Field>
          <Field id="f-docExpiryDate" label={tf('docExpiryDate')} optional={tf('optional')} hint={hint('docExpiryDate')} error={errors.docExpiryDate}>
            <Input {...fieldAria('f-docExpiryDate', errors.docExpiryDate)} type="date" value={form.docExpiryDate} onChange={set('docExpiryDate')} />
            {checkTag('docExpiryDate')}
          </Field>
          <fieldset className="grid gap-2" aria-describedby={errors.declaredMoroccanNationality ? 'f-moroccan-error' : undefined}>
            <legend className="mb-1 text-sm font-medium">{tf('moroccan')}</legend>
            <div className="flex gap-3">
              {(['yes', 'no'] as const).map((v) => (
                <label key={v} className={`inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-pill border px-4 font-display text-sm font-bold ${form.declaredMoroccanNationality === v ? 'border-brand-100 bg-brand-50 text-link' : 'border-bone bg-mist text-ink'}`}>
                  <input id={`f-moroccan-${v}`} type="radio" name="declaredMoroccanNationality" value={v} checked={form.declaredMoroccanNationality === v} onChange={set('declaredMoroccanNationality')} className="size-4 accent-[var(--link)]" />
                  {tf(v)}
                </label>
              ))}
            </div>
            {errors.declaredMoroccanNationality && (
              <p id="f-moroccan-error" className="text-sm text-danger">
                {errors.declaredMoroccanNationality}
              </p>
            )}
          </fieldset>
        </Card>

        <Card className="space-y-4">
          <h2 className="font-display text-lg font-semibold">{tf('staySection')}</h2>
          {stampNeeded && (
            <Field id="f-entryStampNumber" label={tf('entryStampNumber')} hint={stampHint} error={errors.entryStampNumber}>
              <Input {...fieldAria('f-entryStampNumber', errors.entryStampNumber, stampHint)} autoComplete="off" value={form.entryStampNumber} onChange={set('entryStampNumber')} />
            </Field>
          )}
          <Field id="f-cityOfOrigin" label={tf('cityOfOrigin')} error={errors.cityOfOrigin}>
            <Input {...fieldAria('f-cityOfOrigin', errors.cityOfOrigin)} autoComplete="address-level2" dir="auto" value={form.cityOfOrigin} onChange={set('cityOfOrigin')} />
          </Field>
          <Field id="f-nextDestination" label={tf('nextDestination')} error={errors.nextDestination}>
            <Input {...fieldAria('f-nextDestination', errors.nextDestination)} autoComplete="off" dir="auto" value={form.nextDestination} onChange={set('nextDestination')} />
          </Field>
          <Field id="f-profession" label={tf('profession')} error={errors.profession}>
            <Input {...fieldAria('f-profession', errors.profession)} autoComplete="organization-title" dir="auto" value={form.profession} onChange={set('profession')} />
          </Field>
        </Card>

        {/* The consent text sits directly above the button that sends the form. */}
        <Card className="space-y-4">
          <h2 className="font-display text-lg font-semibold">{tf('consentTitle')}</h2>
          <p className="max-h-60 overflow-y-auto rounded-card border border-bone bg-mist p-3 text-sm whitespace-pre-line text-carbon" lang={view.consent.locale} data-testid="consent-text">
            {view.consent.body}
          </p>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input id="f-consent" type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} aria-invalid={errors.consent ? true : undefined} className="mt-0.5 size-5 flex-none accent-[var(--link)]" />
            <span>{tf('consentCheck')}</span>
          </label>
          {errors.consent && <p className="text-sm text-danger">{errors.consent}</p>}
          {problem && <Alert>{problem}</Alert>}
          <Button type="submit" className="w-full" disabled={busy !== null}>
            {busy === 'sending' ? tf('sending') : tf('submit')}
          </Button>
        </Card>
      </form>
    );
  }

  if (step === 'done' && done) {
    return (
      <Card className="space-y-4">
        <h1 className="font-display text-2xl leading-[1.3] font-bold tracking-[-0.02em]">{t('done.title')}</h1>
        <Alert tone="success">{t('done.body')}</Alert>
        {done.canAddGuest ? (
          <>
            <p className="text-sm text-slate">{t('done.left', { remaining: done.remaining })}</p>
            <Button className="w-full" onClick={another}>
              {t('done.another')}
            </Button>
          </>
        ) : (
          <p className="text-sm text-slate">{t('done.close')}</p>
        )}
        <span className="sr-only">{tc('appName')}</span>
      </Card>
    );
  }

  return null;
}
