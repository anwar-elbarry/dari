import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** 10+ characters; 128 max so a huge password cannot be used to burn CPU in the hash. */
export class PasswordField {
  @IsString()
  @Length(10, 128)
  password!: string;
}

export class SignupDto extends PasswordField {
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  companyName!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(1, 128)
  password!: string;
}

export class ForgotPasswordDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto extends PasswordField {
  @IsString()
  @Length(20, 200)
  token!: string;
}
