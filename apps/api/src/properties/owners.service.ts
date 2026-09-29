import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOwnerDto, UpdateOwnerDto } from './dto';

const FIELDS = { id: true, name: true, taxId: true, residency: true, bankAccountType: true } as const;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Owner not found.' });

@Injectable()
export class OwnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(user: AuthUser) {
    return this.prisma.forAccount(user.accountId).propertyOwner.findMany({
      select: { ...FIELDS, _count: { select: { properties: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const owner = await this.prisma.forAccount(user.accountId).propertyOwner.findUnique({
      where: { id },
      select: { ...FIELDS, properties: { select: { id: true, name: true }, orderBy: { name: 'asc' } } },
    });
    if (!owner) throw notFound();
    return owner;
  }

  async create(user: AuthUser, dto: CreateOwnerDto, meta: ClientMeta) {
    const owner = await this.prisma.forAccount(user.accountId).propertyOwner.create({ data: { ...dto, accountId: user.accountId }, select: FIELDS });
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'property_owner.created', resourceType: 'PropertyOwner', resourceId: owner.id, ip: meta.ip });
    return owner;
  }

  async update(user: AuthUser, id: string, dto: UpdateOwnerDto, meta: ClientMeta) {
    const db = this.prisma.forAccount(user.accountId);
    const { count } = await db.propertyOwner.updateMany({ where: { id }, data: dto });
    if (count === 0) throw notFound();
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'property_owner.updated', resourceType: 'PropertyOwner', resourceId: id, ip: meta.ip });
    return this.get(user, id);
  }
}
