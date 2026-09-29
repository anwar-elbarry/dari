import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Actions written to the audit trail. Extend this list as phases add sensitive operations
 * (Phase 3: every read of an ID scan or marriage certificate; Phase 4: every share-link access).
 */
export type AuditAction =
  | 'account.signup'
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.password_reset.requested'
  | 'auth.password_reset.completed'
  | 'auth.refresh_token.reuse_detected'
  | 'invitation.created'
  | 'invitation.accepted'
  | 'invitation.revoked'
  | 'property_owner.created'
  | 'property_owner.updated'
  | 'property.created'
  | 'property.updated'
  | 'ical_feed.created'
  | 'ical_feed.updated'
  | 'ical_feed.deleted'
  | 'booking.classified';

export interface AuditEntry {
  accountId: string;
  /** Null for system actions or when the actor is not authenticated yet. */
  actorId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  ip?: string | null;
}

/**
 * Append-only audit trail. Entries carry identifiers only — never passwords, tokens,
 * document numbers or other guest data — so the log itself is not a new store of secrets or PII.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        accountId: entry.accountId,
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        ip: entry.ip ?? null,
      },
    });
  }
}
