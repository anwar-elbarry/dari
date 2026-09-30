import { LicenseType } from '@prisma/client';

/**
 * The licensing checklist is a legal statement (rule 1 in CLAUDE.md): its steps come from counsel's list, never
 * from the code. This parses and validates such a list from a JSON file; the loader (`ops/load-checklist-template`)
 * writes it. Nothing here supplies any step of its own.
 */
export interface TemplateStepInput {
  code: string;
  licenseType: LicenseType | null;
  condition: string | null;
  position: number;
  nameFr: string;
  nameEn: string;
}

export interface TemplateFile {
  city: string;
  validatedBy: string | null;
  validatedAt: Date | null;
  steps: TemplateStepInput[];
}

export type TemplateParse = { ok: true; template: TemplateFile } | { ok: false; problems: string[] };

const CODE = /^[a-z0-9][a-z0-9_-]{1,59}$/;
const LICENSE_TYPES = new Set<string>(Object.values(LicenseType));
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, min: number, max: number): string | null => (typeof v === 'string' && v.trim().length >= min && v.trim().length <= max ? v.trim() : null);

export function parseTemplateFile(raw: unknown): TemplateParse {
  const problems: string[] = [];
  if (!isObject(raw)) return { ok: false, problems: ['the file must be a JSON object'] };

  const city = text(raw.city, 2, 60);
  if (!city) problems.push('"city" is required (2 to 60 characters)');

  const validatedBy = raw.validatedBy === undefined || raw.validatedBy === null ? null : text(raw.validatedBy, 2, 120);
  if (raw.validatedBy !== undefined && raw.validatedBy !== null && !validatedBy) problems.push('"validatedBy" must be 2 to 120 characters');
  let validatedAt: Date | null = null;
  if (raw.validatedAt !== undefined && raw.validatedAt !== null) {
    validatedAt = typeof raw.validatedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.validatedAt) ? new Date(`${raw.validatedAt}T00:00:00.000Z`) : null;
    if (!validatedAt || Number.isNaN(validatedAt.getTime())) problems.push('"validatedAt" must be a date YYYY-MM-DD');
  }
  // A validation without a date, or a date without a validator, is not a validation.
  if ((validatedBy === null) !== (validatedAt === null)) problems.push('"validatedBy" and "validatedAt" go together');

  const steps: TemplateStepInput[] = [];
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) problems.push('"steps" must be a non-empty list');
  else if (raw.steps.length > 200) problems.push('"steps" is limited to 200 entries');
  else {
    const codes = new Set<string>();
    raw.steps.forEach((s, i) => {
      const at = `step ${i + 1}`;
      if (!isObject(s)) return void problems.push(`${at}: must be an object`);
      const code = typeof s.code === 'string' && CODE.test(s.code) ? s.code : null;
      if (!code) problems.push(`${at}: "code" must be lower-case letters, digits, "-" or "_" (2 to 60)`);
      else if (codes.has(code)) problems.push(`${at}: duplicate code "${code}"`);
      else codes.add(code);
      const nameFr = text(s.nameFr, 2, 300);
      const nameEn = text(s.nameEn, 2, 300);
      if (!nameFr) problems.push(`${at}: "nameFr" is required (2 to 300 characters)`);
      if (!nameEn) problems.push(`${at}: "nameEn" is required (2 to 300 characters)`);
      const position = s.position;
      if (typeof position !== 'number' || !Number.isInteger(position) || position < 1 || position > 10_000) problems.push(`${at}: "position" must be a whole number from 1 to 10000`);
      const licenseType = s.licenseType === undefined || s.licenseType === null ? null : typeof s.licenseType === 'string' && LICENSE_TYPES.has(s.licenseType) ? (s.licenseType as LicenseType) : undefined;
      if (licenseType === undefined) problems.push(`${at}: "licenseType" is not a known licence type`);
      const condition = s.condition === undefined || s.condition === null ? null : text(s.condition, 2, 60);
      if (s.condition !== undefined && s.condition !== null && !condition) problems.push(`${at}: "condition" must be 2 to 60 characters`);
      if (code && nameFr && nameEn && typeof position === 'number' && licenseType !== undefined) {
        steps.push({ code, licenseType, condition, position, nameFr, nameEn });
      }
    });
  }

  if (problems.length > 0 || !city) return { ok: false, problems };
  return { ok: true, template: { city, validatedBy, validatedAt, steps } };
}
