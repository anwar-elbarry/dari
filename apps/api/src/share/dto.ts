import { ShareResourceType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Text } from '../checkin/dto';

/**
 * What to share: a guest's Fiche (by guest id) or a property's register (by property and month). The service
 * resolves it through the account-scoped client, so an id from another account is simply not found.
 */
export class CreateShareDto {
  @IsEnum(ShareResourceType)
  resourceType!: ShareResourceType;

  @ValidateIf((o: CreateShareDto) => o.resourceType === 'FICHE_DE_POLICE')
  @IsUUID()
  guestId?: string;

  @ValidateIf((o: CreateShareDto) => o.resourceType === 'POLICE_REGISTER')
  @IsUUID()
  propertyId?: string;

  @ValidateIf((o: CreateShareDto) => o.resourceType === 'POLICE_REGISTER')
  @Matches(/^20\d\d-(0[1-9]|1[0-2])$/)
  month?: string;

  /** Chosen by the manager within the RuleConfig bounds (checked in the service); 168 is the hard ceiling. */
  @IsInt()
  @Min(1)
  @Max(168)
  expiresInHours!: number;

  /** Who the link is for, as a reminder to the manager. Never shown to the recipient. */
  @Text(2, 80)
  recipientLabel!: string;

  /** Also send the link by WhatsApp to this number (E.164). Used for this one message and stored nowhere. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  whatsappTo?: string;
}
