import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('writes exactly the audit fields', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new AuditService({ auditLog: { create } } as unknown as PrismaService);

    await service.record({
      accountId: 'acc-1',
      actorId: 'user-1',
      action: 'property.created',
      resourceType: 'Property',
      resourceId: 'prop-1',
      ip: '203.0.113.7',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        accountId: 'acc-1',
        actorId: 'user-1',
        action: 'property.created',
        resourceType: 'Property',
        resourceId: 'prop-1',
        ip: '203.0.113.7',
      },
    });
  });

  it('stores a null ip when none is given', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new AuditService({ auditLog: { create } } as unknown as PrismaService);

    await service.record({ accountId: 'a', actorId: null, action: 'auth.logout', resourceType: 'User', resourceId: 'u' });

    expect(create.mock.calls[0][0].data.ip).toBeNull();
  });
});
