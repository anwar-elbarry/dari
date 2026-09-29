import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppRequest } from '../auth/auth.types';
import { IS_PUBLIC } from '../auth/decorators';
import { can, Capability } from './capabilities';
import { REQUIRES } from './requires.decorator';

/**
 * Runs after AuthGuard. Deny by default: a non-public route without @Requires() or @AnyRole()
 * is refused, so forgetting the declaration can never open a route.
 */
@Injectable()
export class CapabilitiesGuard implements CanActivate {
  private readonly logger = new Logger('RBAC');

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const required = this.reflector.getAllAndOverride<Capability[] | undefined>(REQUIRES, targets);
    if (required === undefined) {
      this.logger.error(`Route ${context.getClass().name}.${context.getHandler().name} declares no capability; refused.`);
      throw forbidden();
    }

    const user = context.switchToHttp().getRequest<AppRequest>().user;
    if (!user || !required.every((c) => can(user.role, c))) throw forbidden();
    return true;
  }
}

const forbidden = () => new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this action.' });
