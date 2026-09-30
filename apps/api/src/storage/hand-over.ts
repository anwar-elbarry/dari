/**
 * Replacing the file a record points at (a Fiche or a register PDF) without ever leaving an unreachable copy:
 *   1. the new file is written with `provisionalUntil()`: if nothing adopts it, the retention job purges it;
 *   2. in the transaction that points the record at it, `handOver()` makes it permanent and marks the replaced
 *      file due at once, so the retention job deletes it even if the immediate delete that follows fails.
 * The record update must be a compare-and-swap on the previous file id, so two parallel generations each
 * release exactly the file they replaced.
 */

/** How long a newly written file may stay unreferenced (a crash or a lost race) before the retention job removes it. */
export const PROVISIONAL_MS = 60 * 60_000;

export function provisionalUntil(now = new Date()): Date {
  return new Date(now.getTime() + PROVISIONAL_MS);
}

interface StoredObjectTx {
  storedObject: { updateMany(args: { where: { id: string; deletedAt: null }; data: { expiresAt: Date | null } }): Promise<unknown> };
}

export async function handOver(tx: StoredObjectTx, next: string, previous: string | null, now = new Date()): Promise<void> {
  await tx.storedObject.updateMany({ where: { id: next, deletedAt: null }, data: { expiresAt: null } });
  if (previous && previous !== next) await tx.storedObject.updateMany({ where: { id: previous, deletedAt: null }, data: { expiresAt: now } });
}
