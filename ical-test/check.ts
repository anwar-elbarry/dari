/**
 * Dry-run the fake feeds in this folder through the real parser and classifier:
 *   npx tsx ical-test/check.ts            (every .ics)
 *   npx tsx ical-test/check.ts airbnb-busy.ics
 * The platform is taken from the file name (airbnb*, booking*, direct*, anything else = OTHER).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { BookingSource } from '@prisma/client';
import { classify, storableSummary } from '../apps/api/src/ical/classify';
import { parseIcs } from '../apps/api/src/ical/parse';

const dir = __dirname;
const platformOf = (file: string): BookingSource => {
  const n = basename(file).toLowerCase();
  if (n.startsWith('airbnb')) return 'AIRBNB';
  if (n.startsWith('booking')) return 'BOOKING';
  if (n.startsWith('direct')) return 'DIRECT';
  return 'OTHER';
};

const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith('.ics'));
for (const file of files) {
  const platform = platformOf(file);
  const { events, skipped } = parseIcs(readFileSync(join(dir, file), 'utf8'));
  console.log(`\n${basename(file)}  [${platform}]  events=${events.length} skipped=${skipped}`);
  for (const ev of events) {
    const { classification, reason } = classify(platform, ev.summary);
    const stored = storableSummary(platform, ev.summary);
    const flags = [ev.cancelled ? 'CANCELLED' : null, stored === null ? 'summary not stored' : null].filter(Boolean).join(', ');
    console.log(`  ${ev.start} -> ${ev.end}  ${classification.padEnd(11)} ${reason.padEnd(28)} ${flags}`);
  }
}
