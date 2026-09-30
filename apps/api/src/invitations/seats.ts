import { ConflictException } from "@nestjs/common";
import type { Prisma, Role } from "@prisma/client";

export const seatLimitReached = () =>
  new ConflictException({
    code: "SEAT_LIMIT_REACHED",
    message: "All seats of your plan are in use. Free a seat or change plan.",
  });

/**
 * Serialises seat changes of one account: the caller holds the row lock until its transaction ends, so two
 * parallel invitations (or an invitation racing a re-enable) cannot both take the last seat. Returns the limit.
 */
export async function lockAccountSeats(
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<
    { seatLimit: number }[]
  >`SELECT "seatLimit" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
  return rows[0]?.seatLimit ?? 0;
}

/**
 * A seat is an active (not disabled) user, or a pending, unexpired invitation, whose role is one the plan counts
 * (`countedRoles`, from RuleConfig `plan.seat_limits`). The Accountant is not counted by default: a read-only reader.
 */
export async function seatsInUse(
  tx: Prisma.TransactionClient,
  accountId: string,
  countedRoles: Role[],
  now = new Date(),
): Promise<number> {
  const [users, invitations] = await Promise.all([
    tx.user.count({
      where: { accountId, disabledAt: null, role: { in: countedRoles } },
    }),
    tx.invitation.count({
      where: {
        accountId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
        role: { in: countedRoles },
      },
    }),
  ]);
  return users + invitations;
}
