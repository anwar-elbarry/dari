import { Transform } from 'class-transformer';
import { IsObject, IsOptional } from 'class-validator';

/** Multipart field `mapping` arrives as a JSON string; a wrong shape is a validation error. */
const parseJson = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return 'invalid';
  }
};

export class ImportBodyDto {
  @IsOptional()
  @Transform(parseJson)
  @IsObject()
  mapping?: Record<string, string>;
}

