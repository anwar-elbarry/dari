import { BankAccountType, LicenseStatus, LicenseType, Residency, TaxeSejourMode, TaxRegime } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateOwnerDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  /** CIN, IF or foreign tax number. Stored as given; not validated against any registry. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  taxId?: string;

  @IsEnum(Residency)
  residency!: Residency;

  @IsOptional()
  @IsEnum(BankAccountType)
  bankAccountType?: BankAccountType;
}

export class UpdateOwnerDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  taxId?: string;

  @IsOptional()
  @IsEnum(Residency)
  residency?: Residency;

  @IsOptional()
  @IsEnum(BankAccountType)
  bankAccountType?: BankAccountType;
}

/**
 * License type, tax regime and Taxe de Séjour mode are required choices, not defaults:
 * they drive the checklist and tax calculations later, so a silent guess would be wrong.
 */
export class CreatePropertyDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 255)
  address!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 80)
  commune!: string;

  @IsEnum(LicenseStatus)
  licenseStatus!: LicenseStatus;

  @IsEnum(LicenseType)
  licenseType!: LicenseType;

  @IsEnum(TaxRegime)
  taxRegime!: TaxRegime;

  @IsEnum(TaxeSejourMode)
  taxeSejourMode!: TaxeSejourMode;

  @IsUUID()
  ownerId!: string;
}

/** The iCal link is managed in Phase 2 (sync), not here. */
export class UpdatePropertyDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 255)
  address?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  commune?: string;

  @IsOptional()
  @IsEnum(LicenseStatus)
  licenseStatus?: LicenseStatus;

  @IsOptional()
  @IsEnum(LicenseType)
  licenseType?: LicenseType;

  @IsOptional()
  @IsEnum(TaxRegime)
  taxRegime?: TaxRegime;

  @IsOptional()
  @IsEnum(TaxeSejourMode)
  taxeSejourMode?: TaxeSejourMode;

  @IsOptional()
  @IsUUID()
  ownerId?: string;
}
