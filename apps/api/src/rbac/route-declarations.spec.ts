import { DiscoveryModule } from '@nestjs/core';
import { createTestApp } from '../test/test-app';
import { listRoutes } from '../test/routes';

describe('route access declarations', () => {
  it('every route is either @Public() or declares its capabilities', async () => {
    const { app } = await createTestApp({ extra: [DiscoveryModule] });
    const routes = listRoutes(app);
    await app.close();

    expect(routes.length).toBeGreaterThan(5);
    const undeclared = routes.filter((r) => !r.isPublic && r.requires === undefined);
    expect(undeclared.map((r) => `${r.method} ${r.path} (${r.controller}.${r.handler})`)).toEqual([]);
  });

  it('@SkipCsrf() is on nothing but the signed WhatsApp delivery webhook, and only on a public route', async () => {
    const { app } = await createTestApp({ extra: [DiscoveryModule] });
    const skipping = listRoutes(app).filter((r) => r.skipsCsrf);
    await app.close();

    expect(skipping.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /api/webhooks/whatsapp']);
    expect(skipping.every((r) => r.isPublic)).toBe(true);
  });
});
