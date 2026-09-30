import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Matches, Max, Min } from 'class-validator';

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

/** A money amount as text with at most two decimals ("1234.50"), never a float. `null` clears the figure; a missing key leaves it. */
const MONEY = /^\d{1,9}(\.\d{1,2})?$/;
const moneyMessage = 'must be an amount with at most two decimals';

/** Revenue figures of one stay, entered by hand or corrected after an import. Owner/Manager only (`booking:write`). */
export class AmountsDto {
  @IsOptional() @Matches(MONEY, { message: moneyMessage }) nightlyRevenue?: string | null;
  @IsOptional() @Matches(MONEY, { message: moneyMessage }) cleaningFee?: string | null;
  @IsOptional() @Matches(MONEY, { message: moneyMessage }) addonRevenue?: string | null;
  @IsOptional() @Matches(MONEY, { message: moneyMessage }) discounts?: string | null;
  @IsOptional() @Matches(MONEY, { message: moneyMessage }) refunds?: string | null;
  @IsOptional() @Matches(MONEY, { message: moneyMessage }) platformCommission?: string | null;
  @IsOptional() @Matches(MONEY, { message: moneyMessage }) taxeSejourAmount?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  partySize?: number | null;
}
