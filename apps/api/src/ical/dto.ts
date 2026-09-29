import { BookingSource } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateFeedDto {
  @IsEnum(BookingSource)
  platform!: BookingSource;

  @Transform(trim)
  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  @MaxLength(2048)
  url!: string;
}

export class UpdateFeedDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  @MaxLength(2048)
  url?: string;
}
