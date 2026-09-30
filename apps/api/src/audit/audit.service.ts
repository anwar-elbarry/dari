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
  | 'auth.refresh_token.race'
  | 'invitation.created'
  | 'invitation.accepted'
  | 'invitation.revoked'
  | 'invitation.resent'
  | 'property_owner.created'
  | 'property_owner.updated'
  | 'property.created'
  | 'property.updated'
  | 'ical_feed.created'
  | 'ical_feed.updated'
  | 'ical_feed.deleted'
  | 'booking.classified'
  | 'import.committed'
  | 'alert.resolved'
  // Phase 3: reads of stored personal documents are always audited (rule 3 in CLAUDE.md).
  | 'guest.document.read'
  | 'guest.fiche.read'
  | 'storage.object.deleted'
  | 'checkin.link.created'
  | 'checkin.link.revoked'
  | 'checkin.submitted'
  | 'guest.updated'
  | 'guest.read'
  | 'guest.fiche.regenerated'
  | 'retention.purged'
  // Phase 4: the monthly register and Secure Share. Identifiers only, never a token.
  | 'register.generated'
  | 'register.read'
  | 'share.created'
  | 'share.revoked'
  | 'share.accessed'
  // Phase 5: tax estimates. Identifiers only.
  | 'tax.report.generated'
  | 'tax.export.read'
  | 'booking.amounts.updated'
  // Phase 6: team, licensing checklist, messaging. Identifiers only: never a number, a token or a message body.
  | 'user.role_changed'
  | 'user.disabled'
  | 'user.enabled'
  | 'checklist.updated'
  | 'license_document.read'
  | 'message.sent'
  | 'user.phone_changed';

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
