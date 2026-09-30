import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from '../common/prisma-errors';
import { APP_CONFIG, AppConfig } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccessPayload } from './auth.guard';
import { ClientMeta } from './auth.types';
import { LoginDto, SignupDto } from './dto';
import { LoginLimiter } from './login-limiter';
import { hashToken, randomToken } from './tokens';

export interface SessionTokens {
  access: string;
  refresh: string;
}

/**
 * A rotated refresh token presented again within this window is treated as a race between two
 * tabs (both sent the old cookie before the new one was stored), not as theft: the request fails
 * without revoking the session, and the client retries with the new cookie.
 */
const REUSE_GRACE_MS = 30_000;

const invalidCredentials = () =>
  new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
const invalidSession = () => new UnauthorizedException({ code: 'INVALID_SESSION', message: 'Session expired. Please log in again.' });

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  /** Verified against when the email is unknown, so response time does not reveal whether an account exists. */
  private readonly dummyHash = hashPassword(randomToken());

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly limiter: LoginLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Creates the account and its first Owner/Manager.
   * Known limit: a taken email returns 409, which reveals that the email is registered.
   * Removing that needs email verification at signup (planned after the pilot); rate limits mitigate.
   */
  async signup(dto: SignupDto, meta: ClientMeta): Promise<SessionTokens> {
    const passwordHash = await hashPassword(dto.password);
    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const account = await tx.account.create({ data: { companyName: dto.companyName } });
        return tx.user.create({
          data: { accountId: account.id, name: dto.name, email: dto.email, role: 'OWNER_MANAGER', passwordHash },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({ code: 'EMAIL_IN_USE', message: 'An account already uses this email.' });
      }
      throw e;
    }
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'account.signup', resourceType: 'Account', resourceId: user.accountId, ip: meta.ip });
    return this.issueSession(user, meta);
  }

  async login(dto: LoginDto, meta: ClientMeta): Promise<SessionTokens> {
    // Counted before the password is verified, in one atomic step, so parallel guesses cannot slip
    // past the check while a hash is being verified. A success clears the count.
    if (LoginLimiter.blocked(await this.limiter.recordAttempt(dto.email))) {
      throw new HttpException({ code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Try again in 15 minutes.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const valid = await argon2.verify(user?.passwordHash ?? (await this.dummyHash), dto.password);

    if (!user || !valid || user.disabledAt) {
      if (user) {
        await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'auth.login.failure', resourceType: 'User', resourceId: user.id, ip: meta.ip });
      }
      throw invalidCredentials();
    }

    await this.limiter.reset(dto.email);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'auth.login.success', resourceType: 'User', resourceId: user.id, ip: meta.ip });
    return this.issueSession(user, meta);
  }

  async refresh(rawToken: string | undefined, meta: ClientMeta): Promise<SessionTokens> {
    if (!rawToken) throw invalidSession();
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });
    if (!token) throw invalidSession();

    const now = new Date();
    if (token.revokedAt) {
      // Revoked by logout, password reset or a security revoke: simply expired.
      if (!token.replacedById) throw invalidSession();
      // Rotated: a race between tabs if recent, otherwise a copied token being replayed.
      if (now.getTime() - token.revokedAt.getTime() < REUSE_GRACE_MS) {
        await this.audit.record({ accountId: token.user.accountId, actorId: token.userId, action: 'auth.refresh_token.race', resourceType: 'User', resourceId: token.userId, ip: meta.ip });
        throw new UnauthorizedException({ code: 'REFRESH_RACE', message: 'Session was just refreshed. Retry.' });
      }
      await this.revokeAllSessions(token.userId);
      await this.audit.record({ accountId: token.user.accountId, actorId: token.userId, action: 'auth.refresh_token.reuse_detected', resourceType: 'User', resourceId: token.userId, ip: meta.ip });
      throw invalidSession();
    }
    if (token.expiresAt <= now || token.user.disabledAt) throw invalidSession();

    const next = randomToken();
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Claim the old token atomically: a concurrent refresh with the same token gets count 0.
      const claim = await tx.refreshToken.updateMany({ where: { id: token.id, revokedAt: null }, data: { revokedAt: now } });
      if (claim.count === 0) return false;
      const created = await tx.refreshToken.create({ data: this.refreshTokenData(token.userId, next, meta) });
      await tx.refreshToken.update({ where: { id: token.id }, data: { replacedById: created.id } });
      return true;
    });
    if (!rotated) {
      await this.audit.record({ accountId: token.user.accountId, actorId: token.userId, action: 'auth.refresh_token.race', resourceType: 'User', resourceId: token.userId, ip: meta.ip });
      throw new UnauthorizedException({ code: 'REFRESH_RACE', message: 'Session was just refreshed. Retry.' });
    }

    return { access: await this.signAccess(token.user), refresh: next };
  }

  async logout(rawToken: string | undefined, meta: ClientMeta): Promise<void> {
    if (!rawToken) return;
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });
    if (!token) return;
    await this.prisma.refreshToken.updateMany({ where: { id: token.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.record({ accountId: token.user.accountId, actorId: token.userId, action: 'auth.logout', resourceType: 'User', resourceId: token.userId, ip: meta.ip });
  }

  /**
   * Always succeeds from the caller's point of view. The controller does not await it, so neither
   * the database work nor the mail send shows in the response time.
   */
  async forgotPassword(email: string, meta: ClientMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.disabledAt) return;

    const raw = randomToken();
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(now.getTime() + this.config.PASSWORD_RESET_TTL_MIN * 60_000) },
      }),
    ]);
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'auth.password_reset.requested', resourceType: 'User', resourceId: user.id, ip: meta.ip });

    const link = `${this.config.APP_URL}/reset-password#token=${raw}`;
    this.mail
      .send({
        to: user.email,
        subject: 'Réinitialisation du mot de passe / Password reset',
        text: `Pour choisir un nouveau mot de passe / To choose a new password:\n\n${link}\n\nCe lien expire dans ${this.config.PASSWORD_RESET_TTL_MIN} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\nThis link expires in ${this.config.PASSWORD_RESET_TTL_MIN} minutes. If you did not ask for it, ignore this message.`,
      })
      .catch((e: unknown) => this.logger.error(`Password reset mail failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  /** Single use; on success every existing session of the user is revoked. */
  async resetPassword(rawToken: string, password: string, meta: ClientMeta): Promise<void> {
    const invalid = () => new BadRequestException({ code: 'INVALID_TOKEN', message: 'This link is invalid or has expired.' });
    const token = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });
    if (!token || token.user.disabledAt) throw invalid();

    const passwordHash = await hashPassword(password);
    const now = new Date();
    const done = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
      if (claim.count === 0) return false;
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
      await tx.refreshToken.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: now } });
      return true;
    });
    if (!done) throw invalid();

    await this.limiter.reset(token.user.email);
    await this.audit.record({ accountId: token.user.accountId, actorId: token.userId, action: 'auth.password_reset.completed', resourceType: 'User', resourceId: token.userId, ip: meta.ip });
  }

  async issueSession(user: Pick<User, 'id' | 'accountId'>, meta: ClientMeta): Promise<SessionTokens> {
    const refresh = randomToken();
    await this.prisma.refreshToken.create({ data: this.refreshTokenData(user.id, refresh, meta) });
    return { access: await this.signAccess(user), refresh };
  }

  private revokeAllSessions(userId: string) {
    return this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private refreshTokenData(userId: string, raw: string, meta: ClientMeta) {
    return {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      ip: meta.ip,
      userAgent: meta.userAgent,
    };
  }

  private signAccess(user: Pick<User, 'id' | 'accountId'>): Promise<string> {
    const payload: AccessPayload = { sub: user.id, acc: user.accountId };
    return this.jwt.signAsync(payload);
  }
}
