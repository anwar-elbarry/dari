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
});
