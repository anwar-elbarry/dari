import type { PrismaClient } from '@prisma/client';
import type { TemplateFile } from './template-file';

export interface LoadResult {
  created: number;
  updated: number;
  /** Steps already stored for this city that the file does not list. They are left alone: removing one is a decision, not a side effect. */
  unlisted: string[];
}

/**
 * Writes a validated template file. Steps are matched by (city, code). The file's validation replaces the stored
 * one, so a step edited without a `validatedBy` becomes unvalidated again. Existing copies on properties are not
 * touched: they point at the step, so a corrected wording shows up everywhere.
 */
export async function loadChecklistTemplate(prisma: Pick<PrismaClient, '$transaction'>, template: TemplateFile): Promise<LoadResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.checklistTemplateStep.findMany({ where: { cityScope: template.city }, select: { code: true } });
    const known = new Set(existing.map((e) => e.code));
    let created = 0;
    let updated = 0;
    for (const s of template.steps) {
      const data = { licenseTypeScope: s.licenseType, condition: s.condition, position: s.position, nameFr: s.nameFr, nameEn: s.nameEn, validatedBy: template.validatedBy, validatedAt: template.validatedAt };
      await tx.checklistTemplateStep.upsert({ where: { cityScope_code: { cityScope: template.city, code: s.code } }, create: { cityScope: template.city, code: s.code, ...data }, update: data });
      if (known.has(s.code)) updated += 1;
      else created += 1;
    }
    const listed = new Set(template.steps.map((s) => s.code));
    return { created, updated, unlisted: [...known].filter((c) => !listed.has(c)).sort() };
  });
}
