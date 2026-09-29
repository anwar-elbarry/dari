import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Length, MaxLength } from 'class-validator';
import { normalizeEmail, PasswordField } from '../auth/dto';

/** Owner/Manager seats are created at signup only; invitations add Staff or Accountant. */
export const INVITABLE_ROLES = ['STAFF', 'ACCOUNTANT'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export class CreateInvitationDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(INVITABLE_ROLES)
  role!: InvitableRole;
}

export class InvitationTokenDto {
  @IsString()
  @Length(20, 200)
  token!: string;
}

export class AcceptInvitationDto extends PasswordField {
  @IsString()
  @Length(20, 200)
  token!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 120)
  name!: string;
}
