import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APIRequestContext, Browser, BrowserContext, expect, PlaywrightWorkerArgs, test } from '@playwright/test';

/**
 * Phase 6, on a phone: team and seats, the licensing checklist with a document, and the WhatsApp choices and send.
 * Uses the demo account from `npm run db:seed` (Growth plan: 3 seats, used by the owner and Staff; the accountant uses
 * none). The checklist steps below are INVENTED for the test: the real list comes from counsel. Whatever a test
 * changes in the database (invitations, the WhatsApp rules) it puts back, so the other specs see the same state.
 */
const PASSWORD = 'demo-password-123';
const API_DIR = join(__dirname, '..', '..', 'api');
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://dari:dari@localhost:5432/dari_e2e';
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const PDF = Buffer.from('%PDF-1.4\nsynthetic licence document for the e2e\n%%EOF');

/** Sign-in is limited per address and the suite shares one, so each role signs in once through the API. */
async function signIn(playwright: PlaywrightWorkerArgs['playwright'], email: string): Promise<APIRequestContext> {
  const api = await playwright.request.newContext({ baseURL: 'http://localhost:3000', extraHTTPHeaders: { 'X-Requested-With': 'dari' } });
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await api.post('/api/auth/login', { data: { email, password: PASSWORD } });
    if (res.ok()) return api;
    if (res.status() !== 429) break;
    await new Promise((r) => setTimeout(r, (Number(res.headers()['retry-after']) || 60) * 1000 + 500));
  }
  throw new Error(`could not sign in ${email}`);
}

async function browserAs(browser: Browser, api: APIRequestContext): Promise<BrowserContext> {
  return browser.newContext({ ...test.info().project.use, storageState: await api.storageState() });
}

/** Runs a few lines of Prisma against the e2e database (rules and reference data have no API). */
function db(code: string) {
  execFileSync('npx', ['tsx', '-e', `const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); (async () => { ${code} })().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());`], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL },
    stdio: 'pipe',
  });
}

const setRule = (key: string, value: object) =>
  db(`await p.ruleConfig.upsert({ where: { key: ${JSON.stringify(key)} }, update: { value: ${JSON.stringify(value)}, validatedBy: 'e2e' }, create: { key: ${JSON.stringify(key)}, value: ${JSON.stringify(value)}, validatedBy: 'e2e' } });`);

async function newProperty(api: APIRequestContext, name: string): Promise<string> {
  const owners = (await (await api.get('/api/property-owners')).json()) as { id: string }[];
  const created = await api.post('/api/properties', {
    data: { name, address: '5 Derb Phase Six', commune: 'Marrakech', licenseStatus: 'UNLICENSED', licenseType: 'RIAD', taxRegime: 'PROPERTY_INCOME', taxeSejourMode: 'COLLECTED', ownerId: owners[0].id },
  });
  return ((await created.json()) as { id: string }).id;
}

test.describe.configure({ mode: 'serial' });

test('team: seats are counted, a full plan refuses Staff, the accountant takes no seat, and an invitation can be re-sent and cancelled', async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  const api = await signIn(playwright, 'manager@demo.dari.test');
  const context = await browserAs(browser, api);
  const page = await context.newPage();
  const run = Date.now().toString(36);

  // A failed earlier run must not leave a pending invitation that takes a seat.
  for (const inv of (await (await api.get('/api/invitations')).json()) as { id: string }[]) await api.delete(`/api/invitations/${inv.id}`);

  try {
    await page.goto('/team');
    await expect(page.getByRole('heading', { name: 'Équipe', level: 1 })).toBeVisible();
    await expect(page.getByText('2 places utilisées sur 3')).toBeVisible();
    await expect(page.getByText('Demo Manager (vous)')).toBeVisible();
    const staffRow = page.locator('li', { hasText: 'staff@demo.dari.test' });
    await expect(staffRow.getByRole('button', { name: "Retirer l'accès" })).toBeVisible();
    await expect(page.locator('li', { hasText: 'manager@demo.dari.test' }).getByRole('button')).toHaveCount(0); // your own row cannot be changed

    await test.step('a Staff invitation takes the last seat; the next one is refused with a clear message', async () => {
      await page.getByLabel('E-mail').fill(`seat-${run}@e2e.test`);
      await page.getByRole('button', { name: "Envoyer l'invitation" }).click();
      await expect(page.getByText(`Invitation envoyée à seat-${run}@e2e.test.`)).toBeVisible();
      await expect(page.getByText('3 places utilisées sur 3')).toBeVisible();
      await expect(page.getByText('Toutes les places sont utilisées.')).toBeVisible();

      await page.getByLabel('E-mail').fill(`over-${run}@e2e.test`);
      await page.getByRole('button', { name: "Envoyer l'invitation" }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Toutes les places de votre offre sont utilisées' })).toBeVisible();
    });

    await test.step('the accountant takes no seat', async () => {
      await page.getByLabel('E-mail').fill(`acc-${run}@e2e.test`);
      await page.getByLabel('Rôle', { exact: true }).selectOption('ACCOUNTANT');
      await page.getByRole('button', { name: "Envoyer l'invitation" }).click();
      await expect(page.getByText(`Invitation envoyée à acc-${run}@e2e.test.`)).toBeVisible();
      await expect(page.getByText('3 places utilisées sur 3')).toBeVisible();
    });

    await test.step('an invitation is sent again, then cancelled, and the seat is free again', async () => {
      const pending = page.locator('li', { hasText: `seat-${run}@e2e.test` });
      await pending.getByRole('button', { name: 'Renvoyer' }).click();
      await expect(page.getByText(`Invitation renvoyée à seat-${run}@e2e.test.`)).toBeVisible();
      await pending.getByRole('button', { name: 'Annuler' }).click();
      await expect(page.getByText('Invitation annulée.')).toBeVisible();
      await expect(page.getByText('2 places utilisées sur 3')).toBeVisible();
    });
  } finally {
    for (const inv of (await (await api.get('/api/invitations')).json()) as { id: string }[]) await api.delete(`/api/invitations/${inv.id}`);
    await context.close();
  }
});

test('checklist: progress, a note and a deadline, an encrypted document that downloads back, and Staff see status only', async ({ playwright, browser }) => {
  test.setTimeout(240_000);
  const manager = await signIn(playwright, 'manager@demo.dari.test');
  const context = await browserAs(browser, manager);
  const page = await context.newPage();
  const runId = Date.now().toString(36);
  const propertyName = `Riad Checklist ${runId}`;
  const first = `Étape A (essai ${runId})`;
  const second = `Étape B (essai ${runId})`;

  await test.step('a template is loaded with the loader (invented steps, not validated) and a property is created', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dari-checklist-')), 'template.json');
    writeFileSync(file, JSON.stringify({
      city: 'Marrakech',
      steps: [
        { code: `e2e-a-${runId}`, position: 9001, nameFr: first, nameEn: `Step A (test ${runId})` },
        { code: `e2e-b-${runId}`, position: 9002, condition: 'essai', nameFr: second, nameEn: `Step B (test ${runId})` },
      ],
    }));
    execFileSync('npx', ['tsx', 'src/ops/load-checklist-template.ts', file], { cwd: API_DIR, env: { ...process.env, DATABASE_URL }, stdio: 'pipe' });
  });
  const propertyId = await newProperty(manager, propertyName);

  await test.step('the property page leads to the checklist, which says the list is not validated', async () => {
    await page.goto(`/properties/${propertyId}`);
    await page.getByRole('link', { name: "Checklist d'autorisation" }).click();
    await expect(page.getByRole('heading', { name: "Checklist d'autorisation", level: 1 })).toBeVisible();
    await expect(page.getByText("Cette liste n'a pas encore été validée par un professionnel du droit.")).toBeVisible();
    await expect(page.getByText(first)).toBeVisible();
    await expect(page.getByText('Seulement si : essai').first()).toBeVisible(); // earlier runs leave their steps in this database
  });

  await test.step('ticking a step moves the progress', async () => {
    const total = await page.getByRole('progressbar').getAttribute('aria-valuemax');
    await page.getByLabel(`Statut de l'étape ${first}`).selectOption('DONE');
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    await page.getByLabel(`Statut de l'étape ${second}`).selectOption('NOT_APPLICABLE');
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', String(Number(total) - 1)); // not applicable leaves the count
  });

  await test.step('a deadline and a note are saved', async () => {
    const card = page.locator('li', { has: page.getByText(first) });
    await card.getByRole('button', { name: 'Détails' }).click();
    await card.getByLabel('Échéance').fill('2030-01-15');
    await card.getByLabel('Note').fill('Titre foncier reçu, syndic à relancer');
    await card.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByText('Enregistré.')).toBeVisible();
    await expect(card.getByText('Échéance: 2030-01-15')).toBeVisible();
  });

  await test.step('a document is attached, downloads back byte for byte, and is removed', async () => {
    const card = page.locator('li', { has: page.getByText(first) });
    await card.locator('input[type=file]').setInputFiles({ name: 'licence.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.getByText('Document joint.')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Télécharger' }).click()]);
    expect(download.suggestedFilename()).toBe('document.pdf');
    expect(readFileSync((await download.path())!).equals(PDF)).toBe(true);

    await card.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a document') });
    await expect(page.getByRole('alert').filter({ hasText: "Ce fichier n'est pas accepté" })).toBeVisible();

    await card.getByRole('button', { name: 'Supprimer le document' }).click();
    await expect(page.getByText('Document supprimé.')).toBeVisible();
    await expect(card.getByText('Aucun document joint.')).toBeVisible();
  });

  await test.step('Staff see the steps and their status, and nothing to edit or read', async () => {
    const staffApi = await signIn(playwright, 'staff@demo.dari.test');
    const staff = await browserAs(browser, staffApi);
    const sp = await staff.newPage();
    await sp.goto(`/properties/${propertyId}/checklist`);
    await expect(sp.getByText('Vous voyez les étapes et leur avancement.')).toBeVisible();
    await expect(sp.getByText(first)).toBeVisible();
    await expect(sp.getByText('Terminé', { exact: true })).toBeVisible();
    await expect(sp.getByRole('button', { name: 'Détails' })).toHaveCount(0);
    await expect(sp.getByRole('combobox')).toHaveCount(0);
    expect(await sp.content()).not.toContain('Titre foncier reçu');
    await staff.close();
    await staffApi.dispose();
  });

  await test.step('the accountant is sent to the reports', async () => {
    const accApi = await signIn(playwright, 'accountant@demo.dari.test');
    const acc = await browserAs(browser, accApi);
    const ap = await acc.newPage();
    await ap.goto(`/properties/${propertyId}/checklist`);
    await expect(ap).toHaveURL(/\/reports$/);
    await acc.close();
    await accApi.dispose();
  });

  await context.close();
});

test('WhatsApp: the manager chooses a channel and sends a check-in link from Dari; the number is masked and not kept', async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  const manager = await signIn(playwright, 'manager@demo.dari.test');
  const context = await browserAs(browser, manager);
  const page = await context.newPage();
  const runId = Date.now().toString(36);

  const notReady = {
    checkin_link: { name: null, language: 'fr' },
    day_counter_alert: { name: null, language: 'fr' },
    share_link: { name: null, language: 'fr' },
  };
  try {
    await test.step('before WhatsApp is approved the screen says so and offers only e-mail', async () => {
      setRule('whatsapp.templates', notReady);
      await page.goto('/notifications');
      await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
      await expect(page.getByText("WhatsApp n'est pas encore disponible.")).toBeVisible();
      await page.getByLabel('Votre numéro WhatsApp').fill('0612345678');
      await page.getByRole('button', { name: 'Enregistrer le numéro' }).click();
      await expect(page.getByText(/avec l'indicatif du pays/i).first()).toBeVisible();
    });

    setRule('whatsapp.templates', {
      checkin_link: { name: 'checkin_link_e2e', language: 'fr' },
      day_counter_alert: { name: 'day_counter_alert_e2e', language: 'fr' },
      share_link: { name: 'share_link_e2e', language: 'fr' },
    });
    setRule('messaging.quiet_hours', { start: '00:00', end: '00:00', timezone: 'Africa/Casablanca' });

    await test.step('with a number saved, WhatsApp can be chosen for the critical alert', async () => {
      await page.goto('/notifications');
      await expect(page.getByText("WhatsApp n'est pas encore disponible.")).toHaveCount(0);
      await page.getByLabel('Votre numéro WhatsApp').fill('+212 6 12 34 56 78');
      await page.getByRole('button', { name: 'Enregistrer le numéro' }).click();
      await expect(page.getByText('Numéro enregistré.')).toBeVisible();
      await expect(page.getByText('Numéro actuel : +212•••••••78')).toBeVisible();
      expect(await page.content()).not.toContain('612345678');
      await page.getByLabel('Alerte critique: Comment être prévenu').selectOption('WHATSAPP');
      await expect(page.getByText('Choix enregistré.')).toBeVisible();
      await page.reload();
      await expect(page.getByLabel('Alerte critique: Comment être prévenu')).toHaveValue('WHATSAPP');
    });

    await test.step('removing the number puts the choice back to e-mail', async () => {
      await page.getByRole('button', { name: 'Supprimer le numéro' }).click();
      await expect(page.getByText('Numéro supprimé.')).toBeVisible();
      await expect(page.getByLabel('Alerte critique: Comment être prévenu')).toHaveValue('EMAIL');
    });

    await test.step('the check-in link dialog sends the link and shows how it went; the manual button is gone', async () => {
      const propertyId = await newProperty(manager, `Riad WhatsApp ${runId}`);
      const csv = `check_in,check_out,platform,confirmation_code\n${iso(3)},${iso(5)},DIRECT,P6-${runId}\n`;
      await manager.post(`/api/properties/${propertyId}/imports`, { multipart: { file: { name: 'stay.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) } } });

      await page.goto(`/properties/${propertyId}/arrivals`);
      await page.getByRole('button', { name: 'Envoyer le lien' }).first().click();
      const dialog = page.getByRole('dialog', { name: "Envoyer le lien d'enregistrement" });
      await dialog.getByLabel('L\'envoyer par WhatsApp depuis Dari').fill('nope');
      await dialog.getByRole('button', { name: 'Créer le lien' }).click();
      await expect(dialog.getByText(/avec l'indicatif du pays/i).first()).toBeVisible(); // refused before anything is created

      await dialog.getByLabel('L\'envoyer par WhatsApp depuis Dari').fill('+212 6 12 34 56 78');
      await dialog.getByRole('button', { name: 'Créer le lien' }).click();
      await expect(dialog.getByText('Envoyé par WhatsApp : Envoyé.')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Copier le lien' })).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'Envoyer par WhatsApp' })).toHaveCount(0); // no wa.me hand-off once Dari sends it
      expect(await dialog.textContent()).not.toContain('612345678');
      await dialog.getByRole('button', { name: 'Terminé' }).click();

      await page.getByRole('button', { name: "Voir l'envoi" }).first().click();
      await expect(page.getByRole('list', { name: 'Envoi' }).getByText('WhatsApp')).toBeVisible();
      await expect(page.getByRole('list', { name: 'Envoi' }).getByText('Envoyé', { exact: true })).toBeVisible();
    });
  } finally {
    setRule('whatsapp.templates', notReady); // the other specs expect the manual WhatsApp button
    await context.close();
  }
});
