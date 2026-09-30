/*
 * Loads counsel's licensing checklist for a city from a JSON file:
 *   npm run checklist:load -w apps/api -- path/to/marrakech.json
 * File shape: { "city": "Marrakech", "validatedBy": "Name", "validatedAt": "2026-10-31", "steps": [
 *   { "code": "proof_of_ownership", "licenseType": "RIAD" | null, "condition": "meals" | null, "position": 1,
 *     "nameFr": "...", "nameEn": "..." } ] }
 * Leave out validatedBy / validatedAt until counsel has approved the list: the app then labels it "not validated".
 * The steps are a legal statement and come only from counsel; nothing in the code supplies any.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { parseTemplateFile } from '../checklist/template-file';
import { loadChecklistTemplate } from '../checklist/template-loader';

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: load-checklist-template <file.json>');
    process.exit(2);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.error('the file cannot be read or is not valid JSON');
    process.exit(2);
  }
  const parsed = parseTemplateFile(raw);
  if (!parsed.ok) {
    console.error(`the file is not accepted:\n${parsed.problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const r = await loadChecklistTemplate(prisma, parsed.template);
    console.log(`${parsed.template.city}: ${r.created} created, ${r.updated} updated, ${parsed.template.validatedBy ? 'validated' : 'NOT validated'}.`);
    if (r.unlisted.length > 0) console.log(`Stored but not in the file (left as they are): ${r.unlisted.join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
