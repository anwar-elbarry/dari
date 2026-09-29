'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Require } from '../../../../components/require';
import { Alert, Button, Card, Field, fieldAria, Input, Select } from '../../../../components/ui';
import { api } from '../../../../lib/api';
import type { BankAccountType, LicenseStatus, LicenseType, Owner, Residency, TaxeSejourMode, TaxRegime } from '../../../../lib/types';
import { useSubmit } from '../../../../lib/use-submit';

const LICENSE_STATUSES: LicenseStatus[] = ['UNLICENSED', 'PENDING', 'LICENSED'];
const LICENSE_TYPES: LicenseType[] = ['FURNISHED_APARTMENT', 'RIAD', 'MAISON_DHOTE', 'AUBERGE'];
const TAX_REGIMES: TaxRegime[] = ['PROPERTY_INCOME', 'PROFESSIONAL', 'COMPANY'];
const TAXE_MODES: TaxeSejourMode[] = ['COLLECTED', 'INCLUDED'];
const RESIDENCIES: Residency[] = ['RESIDENT', 'NON_RESIDENT', 'MRE'];
const BANK_TYPES: BankAccountType[] = ['STANDARD', 'CONVERTIBLE_DIRHAM', 'FOREIGN_CURRENCY'];

const STEP_FIELDS: Record<number, string[]> = {
  1: ['name', 'address', 'commune'],
  2: ['licenseStatus', 'licenseType', 'taxRegime', 'taxeSejourMode'],
};

interface State {
  name: string;
  address: string;
  commune: string;
  licenseStatus: LicenseStatus | '';
  licenseType: LicenseType | '';
  taxRegime: TaxRegime | '';
  taxeSejourMode: TaxeSejourMode | '';
  ownerMode: 'existing' | 'new';
  ownerId: string;
  ownerName: string;
  ownerTaxId: string;
  ownerResidency: Residency;
  ownerBank: BankAccountType;
}

const INITIAL: State = {
  name: '',
  address: '',
  commune: 'Marrakech',
  licenseStatus: '',
  licenseType: '',
  taxRegime: '',
  taxeSejourMode: '',
  ownerMode: 'new',
  ownerId: '',
  ownerName: '',
  ownerTaxId: '',
  ownerResidency: 'RESIDENT',
  ownerBank: 'STANDARD',
};

export default function NewPropertyPage() {
  return (
    <Require capability="property:write">
      <Wizard />
    </Require>
  );
}

function Wizard() {
  const t = useTranslations('wizard');
  const tp = useTranslations('properties');
  const tc = useTranslations('common');
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [s, setS] = useState<State>(INITIAL);
  const [owners, setOwners] = useState<Owner[]>([]);
  const { pending, error, fieldErrors, run } = useSubmit();

  useEffect(() => {
    api<Owner[]>('GET', '/property-owners').then((list) => {
      setOwners(list);
      if (list.length) setS((prev) => ({ ...prev, ownerMode: 'existing', ownerId: list[0].id }));
    });
  }, []);

  // A server-side field error sends the user back to the step that holds the field.
  useEffect(() => {
    const keys = Object.keys(fieldErrors);
    for (const n of [1, 2]) if (keys.some((k) => STEP_FIELDS[n].includes(k))) return setStep(n);
  }, [fieldErrors]);

  const set = <K extends keyof State>(key: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setS({ ...s, [key]: e.target.value as State[K] });

  function goNext() {
    if (formRef.current?.reportValidity()) setStep(step + 1);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step < 3) return goNext();

    const created = await run(async () => {
      let ownerId = s.ownerId;
      if (s.ownerMode === 'new') {
        const owner = await api<Owner>('POST', '/property-owners', {
          name: s.ownerName,
          residency: s.ownerResidency,
          bankAccountType: s.ownerBank,
          ...(s.ownerTaxId ? { taxId: s.ownerTaxId } : {}),
        });
        ownerId = owner.id;
        // If the property call fails now, a retry must reuse this owner rather than create a duplicate.
        setOwners((prev) => [...prev, owner]);
        setS((prev) => ({ ...prev, ownerMode: 'existing', ownerId: owner.id }));
      }
      return api('POST', '/properties', {
        name: s.name,
        address: s.address,
        commune: s.commune,
        licenseStatus: s.licenseStatus,
        licenseType: s.licenseType,
        taxRegime: s.taxRegime,
        taxeSejourMode: s.taxeSejourMode,
        ownerId,
      });
    });
    if (created) router.push('/properties');
  }

  const steps = [t('steps.place'), t('steps.status'), t('steps.owner')];

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-stone-500">
          {t('step', { current: step, total: 3 })} — {steps[step - 1]}
        </p>
        <div className="mt-3 flex gap-1.5" aria-hidden>
          {steps.map((label, i) => (
            <div key={label} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-brand-600' : 'bg-stone-200'}`} />
          ))}
        </div>
      </div>

      <Card>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-5">
          {error && <Alert>{error}</Alert>}

          {step === 1 && (
            <>
              <Field id="name" label={t('name')} error={fieldErrors.name}>
                <Input {...fieldAria('name', fieldErrors.name)} value={s.name} onChange={set('name')} placeholder={t('namePlaceholder')} required minLength={2} maxLength={120} />
              </Field>
              <Field id="address" label={t('address')} error={fieldErrors.address}>
                <Input {...fieldAria('address', fieldErrors.address)} value={s.address} onChange={set('address')} autoComplete="street-address" required minLength={2} maxLength={255} />
              </Field>
              <Field id="commune" label={t('commune')} error={fieldErrors.commune}>
                <Input {...fieldAria('commune', fieldErrors.commune)} value={s.commune} onChange={set('commune')} required minLength={2} maxLength={80} />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Field id="licenseStatus" label={t('licenseStatus')} hint={t('licenseStatusHelp')} error={fieldErrors.licenseStatus}>
                <Select {...fieldAria('licenseStatus', fieldErrors.licenseStatus, t('licenseStatusHelp'))} value={s.licenseStatus} onChange={set('licenseStatus')} required>
                  <option value="" disabled>
                    —
                  </option>
                  {LICENSE_STATUSES.map((v) => (
                    <option key={v} value={v}>
                      {tp(`licenseStatus.${v}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="licenseType" label={t('licenseType')} hint={t('licenseTypeHelp')} error={fieldErrors.licenseType}>
                <Select {...fieldAria('licenseType', fieldErrors.licenseType, t('licenseTypeHelp'))} value={s.licenseType} onChange={set('licenseType')} required>
                  <option value="" disabled>
                    —
                  </option>
                  {LICENSE_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {tp(`licenseType.${v}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="taxRegime" label={t('taxRegime')} hint={t('taxRegimeHelp')} error={fieldErrors.taxRegime}>
                <Select {...fieldAria('taxRegime', fieldErrors.taxRegime, t('taxRegimeHelp'))} value={s.taxRegime} onChange={set('taxRegime')} required>
                  <option value="" disabled>
                    —
                  </option>
                  {TAX_REGIMES.map((v) => (
                    <option key={v} value={v}>
                      {tp(`taxRegime.${v}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="taxeSejourMode" label={t('taxeSejourMode')} hint={t('taxeSejourModeHelp')} error={fieldErrors.taxeSejourMode}>
                <Select {...fieldAria('taxeSejourMode', fieldErrors.taxeSejourMode, t('taxeSejourModeHelp'))} value={s.taxeSejourMode} onChange={set('taxeSejourMode')} required>
                  <option value="" disabled>
                    —
                  </option>
                  {TAXE_MODES.map((v) => (
                    <option key={v} value={v}>
                      {tp(`taxeSejourMode.${v}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-stone-800">{t('ownerChoice')}</legend>
                {owners.length > 0 && (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="radio" name="ownerMode" value="existing" checked={s.ownerMode === 'existing'} onChange={set('ownerMode')} />
                    {t('ownerExisting')}
                  </label>
                )}
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="radio" name="ownerMode" value="new" checked={s.ownerMode === 'new'} onChange={set('ownerMode')} />
                  {t('ownerNew')}
                </label>
              </fieldset>

              {s.ownerMode === 'existing' ? (
                <Field id="ownerId" label={t('ownerSelect')} error={fieldErrors.ownerId}>
                  <Select {...fieldAria('ownerId', fieldErrors.ownerId)} value={s.ownerId} onChange={set('ownerId')} required>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <>
                  <Field id="ownerName" label={t('ownerName')} error={fieldErrors.name}>
                    <Input {...fieldAria('ownerName', fieldErrors.name)} value={s.ownerName} onChange={set('ownerName')} required minLength={2} maxLength={120} />
                  </Field>
                  <Field id="ownerTaxId" label={t('ownerTaxId')} optional={tc('optional')}>
                    <Input {...fieldAria('ownerTaxId')} value={s.ownerTaxId} onChange={set('ownerTaxId')} maxLength={50} />
                  </Field>
                  <Field id="ownerResidency" label={t('ownerResidency')}>
                    <Select {...fieldAria('ownerResidency')} value={s.ownerResidency} onChange={set('ownerResidency')}>
                      {RESIDENCIES.map((v) => (
                        <option key={v} value={v}>
                          {tp(`residency.${v}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field id="ownerBank" label={t('ownerBank')} hint={t('ownerBankHelp')}>
                    <Select {...fieldAria('ownerBank', undefined, t('ownerBankHelp'))} value={s.ownerBank} onChange={set('ownerBank')}>
                      {BANK_TYPES.map((v) => (
                        <option key={v} value={v}>
                          {tp(`bankAccountType.${v}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              )}
              <p className="text-sm text-stone-500">{t('icalLater')}</p>
            </>
          )}

          <div className="flex justify-between gap-3 pt-2">
            {step > 1 ? (
              <Button type="button" variant="secondary" onClick={() => setStep(step - 1)} disabled={pending}>
                {tc('back')}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={pending}>
              {step < 3 ? tc('next') : t('create')}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
