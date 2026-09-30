import { ShareResourceType } from '@prisma/client';

interface ShareLinkTx {
  shareLink: {
    findMany(args: { where: { resourceType: ShareResourceType; resourceId: string; revokedAt: null }; select: { id: true } }): Promise<{ id: string }[]>;
    updateMany(args: { where: { id: { in: string[] }; revokedAt: null }; data: { revokedAt: Date } }): Promise<unknown>;
  };
}

/**
 * A link gives access to the one file the manager shared. When a Fiche or a register is regenerated, its live
 * links are revoked in the same transaction as the swap, so a recipient never sees a different version (for
 * example a register with guests added after the link was sent). Returns the revoked ids, for the audit trail.
 * Use the account-scoped transaction client.
 */
export async function revokeLinksTo(tx: ShareLinkTx, resourceType: ShareResourceType, resourceId: string, now = new Date()): Promise<string[]> {
  const ids = (await tx.shareLink.findMany({ where: { resourceType, resourceId, revokedAt: null }, select: { id: true } })).map((l) => l.id);
  if (ids.length) await tx.shareLink.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: { revokedAt: now } });
  return ids;
}
