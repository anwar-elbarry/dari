import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../auth/decorators';
import { SKIP_CSRF } from '../common/csrf.guard';
import { REQUIRES } from '../rbac/requires.decorator';

export interface RouteInfo {
  method: string;
  path: string;
  controller: string;
  handler: string;
  isPublic: boolean;
  skipsCsrf: boolean;
  requires: string[] | undefined;
}

const join = (...parts: string[]) =>
  '/' + parts.flatMap((p) => p.split('/')).filter(Boolean).join('/');

/** Every HTTP route registered in the app, with its access declaration. Needs DiscoveryModule imported. */
export function listRoutes(app: INestApplication): RouteInfo[] {
  const discovery = app.get(DiscoveryService);
  const scanner = new MetadataScanner();
  const reflector = app.get(Reflector);
  const routes: RouteInfo[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
    const proto = Object.getPrototypeOf(instance);
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      const path = Reflect.getMetadata(PATH_METADATA, handler);
      if (path === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      const targets = [handler, metatype];
      routes.push({
        method,
        path: join('api', base, String(path)),
        controller: metatype.name,
        handler: name,
        isPublic: !!reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets),
        skipsCsrf: !!reflector.getAllAndOverride<boolean>(SKIP_CSRF, targets),
        requires: reflector.getAllAndOverride<string[] | undefined>(REQUIRES, targets),
      });
    }
  }
  return routes;
}
