import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Narrows the account-wide report list. */
export class ReportsQuery {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(2000)
  @Max(2099)
  year?: number;

  @IsOptional()
  @IsUUID()
  propertyId?: string;
}
