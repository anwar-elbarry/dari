import { IsBoolean, IsIn, ValidateIf } from 'class-validator';
import { INVITABLE_ROLES, InvitableRole } from './dto';

/**
 * A member's role can only be set to Staff or Accountant, never Owner/Manager: promoting to Owner/Manager
 * (a second account owner) is an open decision for the founder, so it is out of scope here. Demoting an
 * Owner/Manager to Staff or Accountant is allowed, except for the last one (guarded in the service).
 */
export class UpdateMemberDto {
  // Absent is allowed, `null` is not (IsOptional would let it through to the database).
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(INVITABLE_ROLES)
  role?: InvitableRole;

  @ValidateIf((_o, v) => v !== undefined)
  @IsBoolean()
  disabled?: boolean;
}
