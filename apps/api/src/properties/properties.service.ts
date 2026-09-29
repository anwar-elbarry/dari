import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { VALIDATION_FAILED } from '../common/http-exception.filter';
import { PrismaService, ScopedPrisma } from '../prisma/prisma.service';
import { can } from '../rbac/capabilities';
import { CreatePropertyDto, UpdatePropertyDto } from './dto';

/** What Staff see: enough to find the property and know its license status. No owner or tax data. */
export const REDUCED_FIELDS = { id: true, name: true, address: true, commune: true, licenseStatus: true, licenseType: true } as const;

export const FULL_FIELDS = {
  ...REDUCED_FIELDS,
  taxRegime: true,
  taxeSejourMode: true,
  icalUrl: true,
  createdAt: true,
  owner: { select: { id: true, name: true, residency: true } },
} as const;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Property not found.' });

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(user: AuthUser) {
    return this.prisma.forAccount(user.accountId).property.findMany({ select: this.fieldsFor(user), orderBy: { name: 'asc' } });
  }

  async get(user: AuthUser, id: string) {
    const property = await this.prisma.forAccount(user.accountId).property.findUnique({ where: { id }, select: this.fieldsFor(user) });
    if (!property) throw notFound();
    return property;
  }

  async create(user: AuthUser, dto: CreatePropertyDto, meta: ClientMeta) {
    const db = this.prisma.forAccount(user.accountId);
    await this.assertOwnerInAccount(db, dto.ownerId);
    const property = await db.property.create({ data: { ...dto, accountId: user.accountId }, select: FULL_FIELDS });
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'property.created', resourceType: 'Property', resourceId: property.id, ip: meta.ip });
    return property;
  }

  async update(user: AuthUser, id: string, dto: UpdatePropertyDto, meta: ClientMeta) {
    const db = this.prisma.forAccount(user.accountId);
    if (dto.ownerId) await this.assertOwnerInAccount(db, dto.ownerId);
    const { count } = await db.property.updateMany({ where: { id }, data: dto });
    if (count === 0) throw notFound();
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'property.updated', resourceType: 'Property', resourceId: id, ip: meta.ip });
    return this.get(user, id);
  }

  private fieldsFor(user: AuthUser) {
    return can(user.role, 'property:read_full') ? FULL_FIELDS : REDUCED_FIELDS;
  }

  /** Foreign keys are not covered by the account scope: an owner id from another account must be refused here. */
  private async assertOwnerInAccount(db: ScopedPrisma, ownerId: string) {
    const owner = await db.propertyOwner.findUnique({ where: { id: ownerId }, select: { id: true } });
    if (!owner) {
      throw new BadRequestException({ code: VALIDATION_FAILED, message: 'Request validation failed.', details: [{ field: 'ownerId', errors: ['Owner not found.'] }] });
    }
  }
}
