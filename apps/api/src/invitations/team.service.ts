import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { AuditService, AuditAction } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { RulesService } from '../compliance/rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { lockAccountSeats, seatLimitReached, seatsInUse } from './seats';
import { UpdateMemberDto } from './team.dto';

const MEMBER_FIELDS = {
  id: true,
  name: true,
  email: true,
  role: true,
  disabledAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rules: RulesService,
  ) {}

  /** Members (active and disabled) with seat usage against the plan's limit. Pending invitations come from GET /invitations. */
  async overview(user: AuthUser) {
    const db = this.prisma.forAccount(user.accountId);
    const { countedRoles } = await this.rules.seatPolicy();
    const [members, account, used] = await Promise.all([
      db.user.findMany({
        select: MEMBER_FIELDS,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.account.findUniqueOrThrow({
        where: { id: user.accountId },
        select: { seatLimit: true },
      }),
      this.prisma.$transaction((tx) => seatsInUse(tx, user.accountId, countedRoles)),
    ]);
    return {
      members: members.map(({ disabledAt, ...m }) => ({
        ...m,
        disabled: disabledAt !== null,
      })),
      seats: { used, limit: account.seatLimit },
    };
  }

  /**
   * Change a member's role (Staff/Accountant only) and/or disable/re-enable them. The caller can never change
   * their own row, so an account always keeps its acting Owner/Manager: the last owner cannot be demoted or
   * disabled (only owners can reach this route, and they cannot touch themselves; a peer owner can only be
   * demoted or disabled while the acting owner remains). Re-enabling, or moving a member into a counted role,
   * needs a free seat. Disabling or changing a role ends that member's sessions at once.
   */
  async update(user: AuthUser, id: string, dto: UpdateMemberDto, meta: ClientMeta) {
    if (dto.role === undefined && dto.disabled === undefined) {
      throw new BadRequestException({
        code: 'NOTHING_TO_UPDATE',
        message: 'Provide a role or a disabled flag.',
      });
    }
    const target = await this.prisma.forAccount(user.accountId).user.findFirst({ where: { id }, select: { id: true } });
    if (!target)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Member not found.',
      });
    if (target.id === user.id)
      throw new ForbiddenException({
        code: 'CANNOT_MODIFY_SELF',
        message: 'You cannot change your own role or status.',
      });

    const { countedRoles } = await this.rules.seatPolicy();
    const counted = (role: Role) => countedRoles.includes(role);

    const events = await this.prisma.$transaction(async (tx) => {
      const limit = await lockAccountSeats(tx, user.accountId);
      const current = await tx.user.findFirst({
        where: { id, accountId: user.accountId },
        select: { role: true, disabledAt: true },
      });
      if (!current)
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Member not found.',
        });

      const newRole = dto.role ?? current.role;
      const willDisabled = dto.disabled === true ? true : dto.disabled === false ? false : current.disabledAt !== null;
      const out: AuditAction[] = [];
      if (dto.role !== undefined && dto.role !== current.role) out.push('user.role_changed');
      if (dto.disabled === true && !current.disabledAt) out.push('user.disabled');
      if (dto.disabled === false && current.disabledAt) out.push('user.enabled');
      if (out.length === 0) return out; // no effective change: no write, no audit

      // An account never ends up with no active Owner/Manager. The caller cannot change their own row, but with two owners
      // each can disable the other at the same moment: the lock above serialises them and this re-reads who is still active.
      const wasActiveOwner = current.role === 'OWNER_MANAGER' && current.disabledAt === null;
      if (wasActiveOwner && (newRole !== 'OWNER_MANAGER' || willDisabled)) {
        const others = await tx.user.count({ where: { accountId: user.accountId, role: 'OWNER_MANAGER', disabledAt: null, id: { not: id } } });
        if (others === 0) throw new ConflictException({ code: 'LAST_MANAGER', message: 'The last Owner/Manager cannot be disabled or changed.' });
      }

      // Moving a member into a counted, active seat (re-enabling, or Accountant -> Staff) needs room.
      const wasCounted = current.disabledAt === null && counted(current.role);
      const willCount = !willDisabled && counted(newRole);
      if (willCount && !wasCounted && (await seatsInUse(tx, user.accountId, countedRoles)) >= limit) throw seatLimitReached();

      await tx.user.updateMany({
        where: { id, accountId: user.accountId },
        data: {
          ...(dto.role !== undefined && dto.role !== current.role ? { role: dto.role } : {}),
          ...(dto.disabled === true && !current.disabledAt ? { disabledAt: new Date() } : {}),
          ...(dto.disabled === false && current.disabledAt ? { disabledAt: null } : {}),
        },
      });
      // A new role or a disabled account must not keep working on tokens issued before the change.
      if (out.includes('user.role_changed') || out.includes('user.disabled')) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return out;
    });

    for (const action of events) {
      await this.audit.record({
        accountId: user.accountId,
        actorId: user.id,
        action,
        resourceType: 'User',
        resourceId: id,
        ip: meta.ip,
      });
    }
    const updated = await this.prisma.forAccount(user.accountId).user.findFirstOrThrow({ where: { id }, select: MEMBER_FIELDS });
    const { disabledAt, ...member } = updated;
    return { ...member, disabled: disabledAt !== null };
  }
}
