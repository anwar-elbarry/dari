import { applyDecorators } from '@nestjs/common';
import { DocType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

const clean = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

/** Letters (any script), marks, spaces, hyphen, apostrophe and full stop. No digits, no control or bidi characters. */
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} '.-]*$/u;
/** Free text: anything printable except control, format (bidi overrides, zero-width) and line/paragraph separators, and angle brackets. */
const FREE_TEXT = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]+$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const Text = (min: number, max: number, pattern: RegExp = FREE_TEXT) => applyDecorators(Transform(clean), IsString(), Length(min, max), Matches(pattern));
const OptionalText = (min: number, max: number, pattern?: RegExp) => applyDecorators(IsOptional(), Text(min, max, pattern));

/** Strict `YYYY-MM-DD` that is a real calendar date, or null. */
export function parseIsoDate(value: string): Date | null {
  if (!ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : d;
}

export class CreateLinkDto {
  /** Adults expected to fill in a form. Defaults to the booking's party size, or 2. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxGuests?: number;
}

/**
 * What the guest sends to submit. The four fields the police form needs (entry stamp number, city of origin,
 * next destination, profession) are required here, server-side, whatever the form does (rule 5 in CLAUDE.md).
 * OCR output is never trusted: everything below is what the guest confirmed.
 */
export class SubmitDto {
  @IsUUID()
  draftId!: string;

  /** The exact wording shown above the submit button. Must be an approved row. */
  @IsUUID()
  consentTextId!: string;

  @Equals(true)
  consent!: boolean;

  @IsEnum(DocType)
  docType!: DocType;

  @Text(2, 120, NAME)
  fullName!: string;

  /** ISO 3166 alpha-3, as in the MRZ. */
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/)
  nationality!: string;

  @Transform(clean)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 -]{2,18}[A-Za-z0-9]$/)
  docNumber!: string;

  @Matches(ISO_DATE)
  dob!: string;

  @IsOptional()
  @Matches(ISO_DATE)
  docExpiryDate?: string;

  /** Explicit yes/no: no default, so the question cannot be skipped. */
  @IsBoolean()
  declaredMoroccanNationality!: boolean;

  @Text(1, 40, /^[A-Za-z0-9][A-Za-z0-9 /.-]*$/)
  entryStampNumber!: string;

  @Text(2, 80)
  cityOfOrigin!: string;

  @Text(2, 80)
  nextDestination!: string;

  @Text(2, 80)
  profession!: string;
}

/** Manager corrections. Every field optional; the same rules as the guest form. */
export class UpdateGuestDto {
  @IsOptional()
  @IsEnum(DocType)
  docType?: DocType;

  @OptionalText(2, 120, NAME)
  fullName?: string;

  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/)
  nationality?: string;

  @IsOptional()
  @Transform(clean)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 -]{2,18}[A-Za-z0-9]$/)
  docNumber?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  dob?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  docExpiryDate?: string;

  @IsOptional()
  @IsBoolean()
  declaredMoroccanNationality?: boolean;

  @OptionalText(1, 40, /^[A-Za-z0-9][A-Za-z0-9 /.-]*$/)
  entryStampNumber?: string;

  @OptionalText(2, 80)
  cityOfOrigin?: string;

  @OptionalText(2, 80)
  nextDestination?: string;

  @OptionalText(2, 80)
  profession?: string;

  /** Mark the guest as reviewed by the manager. */
  @IsOptional()
  @Equals(true)
  verified?: boolean;
}

export class ArrivalsQuery {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value))
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class LangQuery {
  @IsOptional()
  @Matches(/^(fr|en)$/)
  lang?: string;
}

export class UploadBodyDto {
  @IsOptional()
  @IsUUID()
  draftId?: string;
}
