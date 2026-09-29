import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthUser, ClientMeta } from '../auth/auth.types';
import { VALIDATION_FAILED } from '../common/http-exception.filter';
import { PropertyEvents } from '../common/property-events';
import { PrismaService } from '../prisma/prisma.service';
import { IMPORT_FIELDS, ImportField, Mapping, parseImport, ParsedImport, REQUIRED_FIELDS } from './csv-import';

export const MAX_UPLOAD_BYTES = 1024 * 1024;
export const PREVIEW_ROWS = 20;
const MAX_ROWS = 5000;

const bad = (field: string, message: string) =>
  new BadRequestException({ code: VALIDATION_FAILED, message: 'Request validation failed.', details: [{ field, errors: [message] }] });

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: PropertyEvents,
  ) {}

  /** Parses and validates; saves nothing. Returns the mapping used, a preview and every error with its line. */
  async preview(user: AuthUser, propertyId: string, file: Buffer | undefined, rawMapping: Record<string, string> | undefined) {
    await this.assertProperty(user, propertyId);
    const parsed = this.parse(file, rawMapping);
    const existing = await this.existingKeys(user, propertyId, parsed);
    return {
      headers: parsed.headers,
      delimiter: parsed.delimiter,
      mapping: rawMapping ? this.mappingFrom(rawMapping) : parsed.suggestedMapping,
      totalRows: parsed.totalRows,
      validRows: parsed.rows.length,
      alreadyImported: parsed.rows.filter((r) => existing.has(this.key(r))).length,
      errors: parsed.errors.slice(0, 200),
      errorCount: parsed.errors.length,
      preview: parsed.rows.slice(0, PREVIEW_ROWS).map((r) => ({ line: r.line, checkIn: r.checkIn, checkOut: r.checkOut, platform: r.platform, confirmationCode: r.confirmationCode, partySize: r.partySize, amounts: r.amounts })),
    };
  }

  /**
   * Saves the valid rows. Idempotent: a row whose confirmation code (or dates + platform) already exists
   * on the property is skipped, so uploading the same file twice creates nothing new.
   * Rows with errors are never saved; the response says how many were left out.
   */
  async commit(user: AuthUser, propertyId: string, file: Buffer | undefined, fileName: string, rawMapping: Record<string, string> | undefined, meta: ClientMeta) {
    await this.assertProperty(user, propertyId);
    const parsed = this.parse(file, rawMapping);
    const existing = await this.existingKeys(user, propertyId, parsed);
    const fresh = parsed.rows.filter((r) => !existing.has(this.key(r)));

    const batch = await this.prisma.$transaction(async (tx) => {
      const b = await tx.importBatch.create({
        data: { accountId: user.accountId, propertyId, fileName: fileName.slice(0, 200), rowCount: parsed.totalRows, importedCount: fresh.length, errorCount: parsed.errors.length, createdBy: user.id },
      });
      if (fresh.length) {
        await tx.booking.createMany({
          data: fresh.map((r) => ({
            accountId: user.accountId,
            propertyId,
            importBatchId: b.id,
            checkIn: new Date(r.checkIn),
            checkOut: new Date(r.checkOut),
            source: r.platform,
            // Imports are records of past stays: they count as bookings. Codes are unique per property.
            confirmationCode: r.confirmationCode ?? `import:${r.checkIn}:${r.checkOut}:${r.platform}`,
            partySize: r.partySize,
            nightlyRevenue: r.amounts.nightly_revenue,
            cleaningFee: r.amounts.cleaning_fee,
            addonRevenue: r.amounts.addon_revenue,
            discounts: r.amounts.discounts,
            refunds: r.amounts.refunds,
            platformCommission: r.amounts.platform_commission,
            taxeSejourAmount: r.amounts.taxe_sejour_amount,
            classification: 'BOOKING' as const,
            classifiedBy: 'MANUAL' as const,
          })),
          skipDuplicates: true,
        });
      }
      return b;
    });

    if (fresh.length) await this.events.nightsChanged(user.accountId, propertyId);
    await this.audit.record({ accountId: user.accountId, actorId: user.id, action: 'import.committed', resourceType: 'ImportBatch', resourceId: batch.id, ip: meta.ip });
    return { batchId: batch.id, imported: fresh.length, skippedExisting: parsed.rows.length - fresh.length, skippedWithErrors: parsed.errors.length ? new Set(parsed.errors.map((e) => e.line)).size : 0, errors: parsed.errors.slice(0, 200) };
  }

  private parse(file: Buffer | undefined, rawMapping: Record<string, string> | undefined): ParsedImport {
    if (!file || file.length === 0) throw bad('file', 'A CSV file is required.');
    if (file.length > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException({ code: 'PAYLOAD_TOO_LARGE', message: 'The file is larger than 1 MB.' });
    const mapping = rawMapping ? this.mappingFrom(rawMapping) : undefined;
    const parsed = parseImport(file.toString('utf8'), mapping, MAX_ROWS);
    if (parsed.totalRows > MAX_ROWS) throw bad('file', `The file has more than ${MAX_ROWS} rows.`);
    const mapped = new Set(Object.values(mapping ?? parsed.suggestedMapping));
    const missing = REQUIRED_FIELDS.filter((f) => !mapped.has(f));
    if (missing.length) throw new BadRequestException({ code: 'MAPPING_INCOMPLETE', message: 'Map the required columns first.', details: missing.map((f) => ({ field: f, errors: ['required'] })) });
    return parsed;
  }

  private mappingFrom(raw: Record<string, string>): Mapping {
    const out: Mapping = {};
    const used = new Set<string>();
    for (const [header, field] of Object.entries(raw)) {
      if (field === '' || field === null) continue;
      if (!(IMPORT_FIELDS as readonly string[]).includes(field)) throw bad('mapping', `Unknown field "${field}".`);
      if (used.has(field)) throw bad('mapping', `Field "${field}" is mapped twice.`);
      used.add(field);
      out[header] = field as ImportField;
    }
    return out;
  }

  private key(r: { checkIn: string; checkOut: string; platform: string; confirmationCode: string | null }) {
    return r.confirmationCode ?? `import:${r.checkIn}:${r.checkOut}:${r.platform}`;
  }

  private async existingKeys(user: AuthUser, propertyId: string, parsed: ParsedImport): Promise<Set<string>> {
    const keys = [...new Set(parsed.rows.map((r) => this.key(r)))];
    if (!keys.length) return new Set();
    const rows = await this.prisma.forAccount(user.accountId).booking.findMany({ where: { propertyId, confirmationCode: { in: keys } }, select: { confirmationCode: true } });
    return new Set(rows.map((r) => r.confirmationCode!));
  }

  private async assertProperty(user: AuthUser, propertyId: string) {
    const p = await this.prisma.forAccount(user.accountId).property.findUnique({ where: { id: propertyId }, select: { id: true } });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Property not found.' });
  }
}
