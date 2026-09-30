import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CsrfGuard, SKIP_CSRF, SkipCsrf } from './csrf.guard';

const context = (method: string, header?: string, skip = false) => {
  class Handler {
    handler() {}
  }
  if (skip) SkipCsrf()(Handler.prototype, 'handler', Object.getOwnPropertyDescriptor(Handler.prototype, 'handler')!);
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, header: (n: string) => (n === 'x-requested-with' ? header : undefined) }) }),
    getHandler: () => Handler.prototype.handler,
    getClass: () => Handler,
  } as unknown as ExecutionContext;
};

describe('CsrfGuard', () => {
  const guard = new CsrfGuard(new Reflector());

  it('lets safe methods through and demands the header on the others', () => {
    expect(guard.canActivate(context('GET'))).toBe(true);
    expect(guard.canActivate(context('POST', 'dari'))).toBe(true);
    expect(() => guard.canActivate(context('POST'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context('PUT', 'other'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context('DELETE'))).toThrow(ForbiddenException);
  });

  it('a route marked @SkipCsrf() needs no header', () => {
    expect(guard.canActivate(context('POST', undefined, true))).toBe(true);
    expect(SKIP_CSRF).toBe('skipCsrf');
  });
});
