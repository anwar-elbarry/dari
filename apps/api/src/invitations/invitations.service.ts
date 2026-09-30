import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { AuthService, hashPassword, SessionTokens } from "../auth/auth.service";
import { AuthUser, ClientMeta } from "../auth/auth.types";
import { hashToken, randomToken } from "../auth/tokens";
import { isUniqueViolation } from "../common/prisma-errors";
import { APP_CONFIG, AppConfig } from "../config/env";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { RulesService } from "../compliance/rules.service";
import { AcceptInvitationDto, CreateInvitationDto } from "./dto";
import { lockAccountSeats, seatLimitReached, seatsInUse } from "./seats";

const PUBLIC_FIELDS = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  createdAt: true,
} as const;

const ROLE_LABEL: Record<string, { fr: string; en: string }> = {
  STAFF: { fr: "Équipe (check-in, ménage)", en: "Staff (check-in, cleaning)" },
  ACCOUNTANT: { fr: "Comptable (lecture seule)", en: "Accountant (read-only)" },
};

const invalidToken = () =>
  new BadRequestException({
    code: "INVALID_TOKEN",
    message: "This invitation is invalid or has expired.",
  });
const emailInUse = () =>
  new ConflictException({
    code: "EMAIL_IN_USE",
    message: "An account already uses this email.",
  });

/** Anti-abuse cap on how many times one invitation's link may be re-issued (operational, not a legal parameter). */
export const MAX_INVITATION_RESENDS = 3;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
    private readonly rules: RulesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * A new invitation replaces any pending one for the same email in this account, and needs a free seat when the
   * role is one the plan counts (Staff): the count and the write are one transaction under a row lock, so two
   * parallel invitations cannot both take the last seat. The Accountant uses no seat.
   * Note: an email already registered in any account returns 409 (one user = one account).
   */
  async create(user: AuthUser, dto: CreateInvitationDto, meta: ClientMeta) {
    if (
      await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true },
      })
    )
      throw emailInUse();

    const db = this.prisma.forAccount(user.accountId);
    const raw = randomToken();
    const now = new Date();
    const { countedRoles } = await this.rules.seatPolicy();
    const invitation = await this.prisma.$transaction(async (tx) => {
      const limit = await lockAccountSeats(tx, user.accountId);
      // Replacing this email's pending invitation first, so a re-invite does not double-count the seat.
      await tx.invitation.updateMany({
        where: {
          accountId: user.accountId,
          email: dto.email,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      if (
        countedRoles.includes(dto.role) &&
        (await seatsInUse(tx, user.accountId, countedRoles, now)) >= limit
      )
        throw seatLimitReached();
      return tx.invitation.create({
        data: {
          accountId: user.accountId,
          email: dto.email,
          role: dto.role,
          tokenHash: hashToken(raw),
          invitedBy: user.id,
          expiresAt: new Date(
            now.getTime() + this.config.INVITATION_TTL_DAYS * 86_400_000,
          ),
        },
        select: PUBLIC_FIELDS,
      });
    });

    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: user.accountId },
      select: { companyName: true },
    });
    try {
      await this.mail.send({
        to: dto.email,
        ...this.invitationMail(account.companyName, dto.role, raw),
      });
    } catch {
      await db.invitation.updateMany({
        where: { id: invitation.id },
        data: { revokedAt: new Date() },
      });
      throw new ServiceUnavailableException({
        code: "MAIL_FAILED",
        message: "The invitation email could not be sent. Try again.",
      });
    }

    await this.audit.record({
      accountId: user.accountId,
      actorId: user.id,
      action: "invitation.created",
      resourceType: "Invitation",
      resourceId: invitation.id,
      ip: meta.ip,
    });
    return invitation;
  }

  listPending(user: AuthUser) {
    return this.prisma.forAccount(user.accountId).invitation.findMany({
      where: {
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke(user: AuthUser, id: string, meta: ClientMeta) {
    const { count } = await this.prisma
      .forAccount(user.accountId)
      .invitation.updateMany({
        where: { id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    if (count === 0)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Invitation not found.",
      });
    await this.audit.record({
      accountId: user.accountId,
      actorId: user.id,
      action: "invitation.revoked",
      resourceType: "Invitation",
      resourceId: id,
      ip: meta.ip,
    });
  }

  /**
   * Re-issues a pending invitation's link, capped at MAX_INVITATION_RESENDS. Only the hash is stored, so the old
   * link cannot be re-sent: a new token is minted (the previous one stops working) and the expiry is refreshed.
   * The seat is unchanged (the invitation already held it).
   */
  async resend(user: AuthUser, id: string, meta: ClientMeta) {
    const db = this.prisma.forAccount(user.accountId);
    const inv = await db.invitation.findFirst({
      where: {
        id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, email: true, role: true, resendCount: true },
    });
    if (!inv)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Invitation not found.",
      });
    if (inv.resendCount >= MAX_INVITATION_RESENDS) {
      throw new HttpException(
        {
          code: "RESEND_CAP_REACHED",
          message:
            "This invitation has been re-sent too many times. Revoke it and invite again.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const raw = randomToken();
    const now = new Date();
    const updated = await db.invitation.updateMany({
      where: { id, acceptedAt: null, revokedAt: null },
      data: {
        tokenHash: hashToken(raw),
        expiresAt: new Date(
          now.getTime() + this.config.INVITATION_TTL_DAYS * 86_400_000,
        ),
        resentAt: now,
        resendCount: { increment: 1 },
      },
    });
    if (updated.count === 0)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "Invitation not found.",
      });

    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: user.accountId },
      select: { companyName: true },
    });
    try {
      await this.mail.send({
        to: inv.email,
        ...this.invitationMail(account.companyName, inv.role, raw),
      });
    } catch {
      throw new ServiceUnavailableException({
        code: "MAIL_FAILED",
        message: "The invitation email could not be sent. Try again.",
      });
    }
    await this.audit.record({
      accountId: user.accountId,
      actorId: user.id,
      action: "invitation.resent",
      resourceType: "Invitation",
      resourceId: id,
      ip: meta.ip,
    });
  }

  /** What the accept screen shows before the person sets a password. */
  async preview(rawToken: string) {
    const inv = await this.findValid(rawToken);
    if (!inv) throw invalidToken();
    return {
      email: inv.email,
      role: inv.role,
      companyName: inv.account.companyName,
      expiresAt: inv.expiresAt,
    };
  }

  /** Creates the user with the role stored on the invitation (never from the request) and starts a session. */
  async accept(
    dto: AcceptInvitationDto,
    meta: ClientMeta,
  ): Promise<SessionTokens> {
    const inv = await this.findValid(dto.token);
    if (!inv) throw invalidToken();

    const passwordHash = await hashPassword(dto.password);
    const now = new Date();
    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const claim = await tx.invitation.updateMany({
          where: {
            id: inv.id,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { acceptedAt: now },
        });
        if (claim.count === 0) throw invalidToken();
        const created = await tx.user.create({
          data: {
            accountId: inv.accountId,
            email: inv.email,
            name: dto.name,
            role: inv.role,
            passwordHash,
          },
        });
        return created.id;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw emailInUse();
      throw e;
    }

    await this.audit.record({
      accountId: inv.accountId,
      actorId: userId,
      action: "invitation.accepted",
      resourceType: "Invitation",
      resourceId: inv.id,
      ip: meta.ip,
    });
    return this.auth.issueSession(
      { id: userId, accountId: inv.accountId },
      meta,
    );
  }

  private async findValid(rawToken: string) {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { account: { select: { companyName: true } } },
    });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= new Date())
      return null;
    return inv;
  }

  private invitationMail(companyName: string, role: string, raw: string) {
    const link = `${this.config.APP_URL}/accept-invitation#token=${raw}`;
    const label = ROLE_LABEL[role] ?? { fr: role, en: role };
    const days = this.config.INVITATION_TTL_DAYS;
    return {
      subject: `Invitation — ${companyName}`,
      text:
        `${companyName} vous invite à rejoindre Dari en tant que ${label.fr}.\nPour accepter et choisir votre mot de passe :\n\n${link}\n\nCe lien expire dans ${days} jours.\n\n` +
        `${companyName} invited you to join Dari as ${label.en}.\nTo accept and choose your password:\n\n${link}\n\nThis link expires in ${days} days.`,
    };
  }
}
