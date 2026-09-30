import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ChecklistStatus, LicenseType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { can } from '../rbac/capabilities';
import { handOver, provisionalUntil } from '../storage/hand-over';
import { StorageService } from '../storage/storage.service';
import { UpdateChecklistItemDto } from './checklist.dto';
import { DocumentRejectedError, isPdf, prepareDocument } from './document-type';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });

interface ItemRow {
  id: string;
  status: ChecklistStatus;
  dueDate: Date | null;
  note: string | null;
  documentObjectId: string | null;
  templateStep: { code: string; nameFr: string; nameEn: string; condition: string | null; position: number };
}

const ITEM_SELECT = {
  id: true,
  status: true,
  dueDate: true,
  note: true,
  documentObjectId: true,
  templateStep: { select: { code: true, nameFr: true, nameEn: true, condition: true, position: true } },
} as const;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Licensing checklist of a property. The steps are copies of the global template (`ChecklistTemplateStep`, from
 * counsel's list: none is written here), made when the checklist is read; ticking, noting and attaching documents
 * happen on the copies. Owner/Manager see everything; Staff see the steps and their status only (no due date, note
 * or document). The document is an encrypted StoredObject, read only through an audited route, never a URL.
 */
@Injectable()
export class ChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async list(user: AuthUser, propertyId: string) {
    const property = await this.property(user, propertyId);
    const steps = await this.applicableSteps(property);
    await this.syncItems(user.accountId, propertyId, steps.map((s) => s.id));
    const items = (await this.prisma.forAccount(user.accountId).checklistItem.findMany({ where: { propertyId }, select: ITEM_SELECT })) as ItemRow[];
    items.sort((a, b) => a.templateStep.position - b.templateStep.position || a.templateStep.code.localeCompare(b.templateStep.code));

    const counted = items.filter((i) => i.status !== 'NOT_APPLICABLE');
    return {
      // Whether the city has a checklist at all, and whether every step in it has been validated by counsel.
      covered: steps.length > 0,
      validated: steps.length > 0 && steps.every((s) => s.validatedBy !== null),
      progress: { done: counted.filter((i) => i.status === 'DONE').length, total: counted.length },
      items: items.map((i) => this.present(user, i)),
    };
  }

  async update(user: AuthUser, propertyId: string, itemId: string, dto: UpdateChecklistItemDto, meta: ClientMeta) {
    if (dto.status === undefined && dto.dueDate === undefined && dto.note === undefined) {
      throw new BadRequestException({ code: 'NOTHING_TO_UPDATE', message: 'Provide a status, a due date or a note.' });
    }
    let dueDate: Date | null | undefined;
    if (dto.dueDate !== undefined) {
      dueDate = dto.dueDate === null ? null : new Date(`${dto.dueDate}T00:00:00.000Z`);
      if (dueDate !== null && (Number.isNaN(dueDate.getTime()) || day(dueDate) !== dto.dueDate)) {
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The due date is not a valid date.' });
      }
    }
    await this.item(user, propertyId, itemId);
    await this.prisma.forAccount(user.accountId).checklistItem.updateMany({
      where: { id: itemId, propertyId },
      data: { ...(dto.status !== undefined ? { status: dto.status } : {}), ...(dueDate !== undefined ? { dueDate } : {}), ...(dto.note !== undefined ? { note: dto.note } : {}), updatedBy: user.id },
    });
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'checklist.updated', resourceType: 'ChecklistItem', resourceId: itemId, ip: meta.ip });
    return this.present(user, await this.item(user, propertyId, itemId));
  }

  /** Replaces the item's document. The new file is provisional until the row adopts it; the replaced one is due at once. */
  async attachDocument(user: AuthUser, propertyId: string, itemId: string, file: Buffer | undefined, meta: ClientMeta) {
    const current = await this.item(user, propertyId, itemId);
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Attach a PDF or a photo.' });
    let prepared;
    try {
      prepared = await prepareDocument(file);
    } catch (e) {
      if (e instanceof DocumentRejectedError) throw new UnprocessableEntityException({ code: e.code, message: 'This file is not accepted. Use a PDF or a photo under 8 MB.' });
      throw e;
    }
    const stored = await this.storage.put(user.accountId, 'LICENSE_DOCUMENT', prepared.bytes, { expiresAt: provisionalUntil() });
    const shred = (objectId: string) => this.storage.delete(user.accountId, objectId, { actorId: user.id, action: 'storage.object.deleted', resourceType: 'ChecklistItem', resourceId: itemId });

    const previous = current.documentObjectId;
    const swapped = await this.prisma
      .forAccount(user.accountId)
      .$transaction(async (tx) => {
        // Compare-and-swap on the previous file, so two parallel uploads each release exactly the file they replaced.
        const r = await tx.checklistItem.updateMany({ where: { id: itemId, accountId: user.accountId, propertyId, documentObjectId: previous }, data: { documentObjectId: stored.id, updatedBy: user.id } });
        if (r.count === 0) return false;
        await handOver(tx, stored.id, previous);
        return true;
      })
      .catch(async (e: unknown) => {
        await shred(stored.id).catch(() => undefined); // if this fails too, the file is provisional
        throw e;
      });
    if (!swapped) {
      await shred(stored.id).catch(() => undefined);
      throw new ConflictException({ code: 'DOCUMENT_CHANGED', message: 'The document was changed at the same time. Try again.' });
    }
    if (previous) await shred(previous).catch(() => undefined); // already due: the retention job finishes it if this fails
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'checklist.updated', resourceType: 'ChecklistItem', resourceId: itemId, ip: meta.ip });
    return this.present(user, await this.item(user, propertyId, itemId));
  }

  /** Detaches and shreds the document. */
  async removeDocument(user: AuthUser, propertyId: string, itemId: string, meta: ClientMeta) {
    const current = await this.item(user, propertyId, itemId);
    const previous = current.documentObjectId;
    if (!previous) throw notFound();
    const released = await this.prisma.forAccount(user.accountId).$transaction(async (tx) => {
      const r = await tx.checklistItem.updateMany({ where: { id: itemId, accountId: user.accountId, propertyId, documentObjectId: previous }, data: { documentObjectId: null, updatedBy: user.id } });
      if (r.count === 0) return false;
      await tx.storedObject.updateMany({ where: { id: previous, deletedAt: null }, data: { expiresAt: new Date() } });
      return true;
    });
    if (!released) throw notFound();
    await this.storage.delete(user.accountId, previous, { actorId: user.id, action: 'storage.object.deleted', resourceType: 'ChecklistItem', resourceId: itemId }).catch(() => undefined);
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'checklist.updated', resourceType: 'ChecklistItem', resourceId: itemId, ip: meta.ip });
  }

  /** Decrypts after the audit row is written (`license_document.read`); no audit row, no bytes. */
  async readDocument(user: AuthUser, propertyId: string, itemId: string, meta: ClientMeta): Promise<{ bytes: Buffer; pdf: boolean }> {
    const item = await this.item(user, propertyId, itemId);
    if (!item.documentObjectId) throw notFound();
    const { bytes } = await this.storage.read(user.accountId, item.documentObjectId, { actorId: user.id, action: 'license_document.read', resourceType: 'ChecklistItem', resourceId: itemId, ip: meta.ip });
    return { bytes, pdf: isPdf(bytes) };
  }

  private async property(user: AuthUser, propertyId: string) {
    const property = await this.prisma.forAccount(user.accountId).property.findFirst({ where: { id: propertyId }, select: { id: true, commune: true, licenseType: true } });
    if (!property) throw notFound();
    return property;
  }

  private async item(user: AuthUser, propertyId: string, itemId: string): Promise<ItemRow> {
    await this.property(user, propertyId);
    const item = await this.prisma.forAccount(user.accountId).checklistItem.findFirst({ where: { id: itemId, propertyId }, select: ITEM_SELECT });
    if (!item) throw notFound();
    return item as ItemRow;
  }

  /**
   * Steps for the property's city (the commune, compared without regard to case) whose licence type is the
   * property's or unrestricted. A step with a `condition` (such as "meals") is included: the property has no field
   * that says whether it applies, so the manager marks it "not applicable" when it does not.
   */
  private applicableSteps(property: { commune: string; licenseType: LicenseType }) {
    return this.prisma.checklistTemplateStep.findMany({
      where: { cityScope: { equals: property.commune.trim(), mode: 'insensitive' }, OR: [{ licenseTypeScope: null }, { licenseTypeScope: property.licenseType }] },
      select: { id: true, validatedBy: true },
    });
  }

  /**
   * Adds the missing copies (idempotent under parallel reads: a unique key and skipDuplicates) and drops copies of
   * steps that no longer apply (the licence type changed) only when nobody has touched them.
   */
  private async syncItems(accountId: string, propertyId: string, stepIds: string[]) {
    const db = this.prisma.forAccount(accountId);
    const existing = await db.checklistItem.findMany({ where: { propertyId }, select: { templateStepId: true } });
    const have = new Set(existing.map((e) => e.templateStepId));
    const missing = stepIds.filter((id) => !have.has(id));
    if (missing.length > 0) await db.checklistItem.createMany({ data: missing.map((templateStepId) => ({ accountId, propertyId, templateStepId })), skipDuplicates: true });
    await db.checklistItem.deleteMany({ where: { propertyId, templateStepId: { notIn: stepIds }, status: 'TODO', note: null, dueDate: null, documentObjectId: null } });
  }

  private present(user: AuthUser, i: ItemRow) {
    const base = { id: i.id, code: i.templateStep.code, nameFr: i.templateStep.nameFr, nameEn: i.templateStep.nameEn, condition: i.templateStep.condition, position: i.templateStep.position, status: i.status };
    // Staff: status only. The capability, not the role name, decides (rule 6).
    if (!can(user.role, 'license_document:read')) return base;
    return { ...base, dueDate: day(i.dueDate), note: i.note, hasDocument: i.documentObjectId !== null };
  }
}
