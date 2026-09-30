import { IsBoolean, IsIn, IsOptional } from "class-validator";
import { INVITABLE_ROLES, InvitableRole } from "./dto";

/**
 * A member's role can only be set to Staff or Accountant, never Owner/Manager: promoting to Owner/Manager
 * (a second account owner) is an open decision for the founder, so it is out of scope here. Demoting an
 * Owner/Manager to Staff or Accountant is allowed, except for the last one (guarded in the service).
 */
export class UpdateMemberDto {
  @IsOptional()
  @IsIn(INVITABLE_ROLES)
  role?: InvitableRole;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}
