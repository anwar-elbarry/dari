import { ChecklistStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value);

/** Every field is optional, `null` clears a due date or a note; at least one must be present (checked in the service). */
export class UpdateChecklistItemDto {
  @IsOptional()
  @IsEnum(ChecklistStatus)
  status?: ChecklistStatus;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
