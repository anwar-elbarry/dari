import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { LicenseType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toCentimes } from './money';
import { DisclaimerText } from './tax-template';
import { parsePropertyIncome, parseRounding, parseStayMonth, parseVat, RULE_KEYS, RuleValue, TaxRules } from './rules';

const DISCLAIMER_KEYS = { beta: { en: 'tax.disclaimer.beta.en', fr: 'tax.disclaimer.beta.fr' }, standard: { en: 'tax.disclaimer.standard.en', fr: 'tax.disclaimer.standard.fr' } } as const;

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 1000;

/** Reads the tax parameters from RuleConfig and TaxRule (rule 1 in CLAUDE.md). Nothing here holds a rate. */
@Injectable()
export class TaxRulesService {
  constructor(private readonly prisma: PrismaService) {}

  private async config<T>(key: string, parse: (v: unknown) => T | null): Promise<RuleValue<T>> {
    const row = await this.prisma.ruleConfig.findUnique({ where: { key } });
    const value = row ? parse(row.value) : null;
    return { key, value, validated: value !== null && !!row?.validatedBy, validatedAt: value !== null && row?.validatedAt ? row.validatedAt.toISOString().slice(0, 10) : null };
  }

  /** The rule for local taxes: the latest TaxRule of the commune and licence type in force at the end of the month. */
  private async localTax(commune: string, licenseType: LicenseType, monthEnd: Date): Promise<TaxRules['localTax']> {
    const row = await this.prisma.taxRule.findFirst({ where: { commune, licenseType, effectiveFrom: { lt: monthEnd } }, orderBy: { effectiveFrom: 'desc' } });
    const supported = row?.basis === 'PER_PERSON_NIGHT';
    const cents = row && supported ? toCentimes(row.tptRate) : null;
    return { key: RULE_KEYS.localTax, value: cents === null ? null : { perPersonNightCentimes: cents }, validated: cents !== null && !!row?.validatedBy, validatedAt: cents !== null && row?.validatedAt ? row.validatedAt.toISOString().slice(0, 10) : null };
  }

  async load(commune: string, licenseType: LicenseType, monthEnd: Date): Promise<TaxRules> {
    const [propertyIncome, vat, rounding, stayMonth, localTax] = await Promise.all([
      this.config(RULE_KEYS.propertyIncome, parsePropertyIncome),
      this.config(RULE_KEYS.vat, parseVat),
      this.config(RULE_KEYS.rounding, parseRounding),
      this.config(RULE_KEYS.stayMonth, parseStayMonth),
      this.localTax(commune, licenseType, monthEnd),
    ]);
    return { propertyIncome, vat, rounding, stayMonth, localTax };
  }

  /**
   * The disclaimer text, in both languages, from RuleConfig. The beta text is used while any rule is unvalidated or
   * missing. Fails closed: with no approved text there is no export, never a wording invented in code.
   */
  async disclaimer(beta: boolean): Promise<{ fr: DisclaimerText; en: DisclaimerText }> {
    const keys = DISCLAIMER_KEYS[beta ? 'beta' : 'standard'];
    const rows = await this.prisma.ruleConfig.findMany({ where: { key: { in: [keys.en, keys.fr] } } });
    const read = (key: string): DisclaimerText | null => {
      const v = rows.find((r) => r.key === key)?.value as Partial<DisclaimerText> | undefined;
      return v && isText(v.version) && isText(v.banner) && isText(v.text) ? { version: v.version, banner: v.banner, text: v.text } : null;
    };
    const en = read(keys.en);
    const fr = read(keys.fr);
    if (!en || !fr) throw new ServiceUnavailableException({ code: 'DISCLAIMER_MISSING', message: 'The disclaimer text is not configured.' });
    return { fr, en };
  }

  /** Every rule with its status, for the rules screen. Values are configuration, not personal data. */
  async status() {
    const keys = [RULE_KEYS.propertyIncome, RULE_KEYS.vat, RULE_KEYS.rounding, RULE_KEYS.stayMonth];
    const rows = await this.prisma.ruleConfig.findMany({ where: { key: { in: keys } }, orderBy: { key: 'asc' } });
    const taxRules = await this.prisma.taxRule.count();
    const [beta, standard] = await Promise.all([this.disclaimer(true), this.disclaimer(false)]);
    return {
      // The wording the screens show, from RuleConfig: the app never writes its own.
      disclaimers: { beta, standard },
      rules: keys.map((key) => {
        const row = rows.find((r) => r.key === key);
        return { key, present: !!row, value: row?.value ?? null, validated: !!row?.validatedBy, validatedBy: row?.validatedBy ?? null, validatedAt: row?.validatedAt ?? null };
      }),
      localTaxRules: taxRules,
    };
  }
}
