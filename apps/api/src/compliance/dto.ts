import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export class YearQuery {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(2020)
  @Max(2100)
  year?: number;
}

export class BookingsQuery {
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  to?: string;
}

/** A person can only decide between a stay and a block; UNCERTAIN is the machine's answer. */
export class ClassifyDto {
  @IsIn(['BOOKING', 'OWNER_BLOCK'])
  classification!: 'BOOKING' | 'OWNER_BLOCK';
}
