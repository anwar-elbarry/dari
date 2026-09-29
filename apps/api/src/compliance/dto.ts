import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  @Matches(DATE)
  from?: string;

  @IsOptional()
  @Matches(DATE)
  to?: string;
}

/** A person can only decide between a stay and a block; UNCERTAIN is the machine's answer. */
export class ClassifyDto {
  @IsIn(['BOOKING', 'OWNER_BLOCK'])
  classification!: 'BOOKING' | 'OWNER_BLOCK';
}
