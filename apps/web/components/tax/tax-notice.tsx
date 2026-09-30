'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { formatCentimes, rulesAreBeta } from '../../lib/tax';
import type { Disclaimer, TaxRules } from '../../lib/types';
import { Alert, StatusPill } from '../ui';

/** Amount with its unit, from integer centimes (no float): "1 234,50 MAD". */
export function useMoney() {
  const t = useTranslations('tax');
  const locale = useLocale();
  return (centimes: number) => t('money', { amount: formatCentimes(centimes, locale) });
}

export type TaxRulesState = 'loading' | 'ok' | 'failed' | 'unavailable';

/**
 * The parameters in force and the disclaimer wording, from GET /tax/rules. The wording is data (RuleConfig): the
 * app never writes its own. A 404 means the feature is off.
 */
export function useTaxRules() {
  const [rules, setRules] = useState<TaxRules | null>(null);
  const [state, setState] = useState<TaxRulesState>('loading');

  const load = useCallback(async () => {
    try {
      setRules(await api<TaxRules>('GET', '/tax/rules'));
      setState('ok');
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? 'unavailable' : 'failed');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return { rules, state, reload: load };
}

/** Whether to show the beta wording for a screen: a report is beta, or a parameter is missing or unvalidated. */
export const isBeta = (rules: TaxRules, reportBeta: boolean) => reportBeta || rulesAreBeta(rules);

const pick = (d: Disclaimer, locale: string) => d[locale === 'en' ? 'en' : 'fr'];

/**
 * The disclaimer on every screen that shows a figure. Beta: an unmissable red banner (2px border, large bold
 * text, icon) carrying the full text. Otherwise the standard text in a normal info notice.
 */
export function TaxNotice({ beta, rules }: { beta: boolean; rules: TaxRules }) {
  const locale = useLocale();
  if (!beta) return <Alert tone="info">{pick(rules.disclaimers.standard, locale).text}</Alert>;
  const { banner, text } = pick(rules.disclaimers.beta, locale);
  return (
    <section role="alert" data-testid="tax-beta-banner" className="space-y-2 rounded-card border-2 border-danger bg-danger-soft p-4 text-ink sm:p-5">
      <div className="flex items-start gap-3">
        <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" className="mt-0.5 flex-none text-danger">
          <path d="M12 3l10 18H2L12 3z" />
          <path d="M12 10v4.5M12 17.5h.01" />
        </svg>
        <p className="font-display text-xl leading-tight font-extrabold tracking-[-0.02em] text-danger sm:text-2xl">{banner}</p>
      </div>
      <p className="text-base leading-snug font-bold">{text}</p>
    </section>
  );
}

/** Small pill for a beta report; the word is required, like every status. */
export function BetaPill() {
  const t = useTranslations('tax');
  return <StatusPill tone="danger">{t('beta')}</StatusPill>;
}
