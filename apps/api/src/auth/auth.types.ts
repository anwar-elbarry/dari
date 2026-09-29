import type { Request } from 'express';
import type { Role } from '@prisma/client';

/** The authenticated user attached to the request by AuthGuard (loaded fresh from the DB). */
export interface AuthUser {
  id: string;
  accountId: string;
  role: Role;
}

export type AppRequest = Request & { user?: AuthUser };

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export function clientMeta(req: Request): ClientMeta {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent')?.slice(0, 255) ?? null };
}
