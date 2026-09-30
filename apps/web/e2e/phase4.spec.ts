import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APIRequestContext, expect, Page, test } from '@playwright/test';

/**
 * Phase 4, manager side, on a phone: a guest has checked in, the manager sees the incomplete record before
 * generating, fixes it, generates the register, shares it (the link is shown once), and revokes it; Staff see
 * status only and cannot share. Uses the demo account from `npm run db:seed`. The guest is created through the
 * public API (the guest screens are covered by phase3.spec.ts) on a property of its own, so other specs'
 * stays do not change the counts.
 */
const PASSWORD = 'demo-password-123';
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const PASSPORT = readFileSync(join(__dirname, 'fixtures', 'synthetic-passport.jpg'));

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe.configure({ mode: 'serial' });

let propertyId: string;
let propertyName: string;
let month: string;
let monthLabel: string;
let guestName: string;
let shareUrl = '';

test('the manager sees the incomplete record, fixes it, generates the register and shares it once', async ({ page, context, playwright, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const runId = Date.now().toString(36);
  propertyName = `Riad Registre ${runId}`;
  guestName = `Anna Test ${runId.replace(/\d/g, (d) => 'abcdefghij'[Number(d)])}`;
  month = iso(-1).slice(0, 7);
  monthLabel = new Intl.DateTimeFormat('fr', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01`));

  await test.step('a property, a stay that began yesterday, and one guest who has checked in (through the API)', async () => {
    const api: APIRequestContext = await playwright.request.newContext({ baseURL: 'http://localhost:3000', extraHTTPHeaders: { 'X-Requested-With': 'dari' } });
    await api.post('/api/auth/login', { data: { email: 'manager@demo.dari.test', password: PASSWORD } });
    const owners = (await (await api.get('/api/property-owners')).json()) as { id: string }[];
    const created = await api.post('/api/properties', {
      data: { name: propertyName, address: '3 Derb Registre', commune: 'Marrakech', licenseStatus: 'LICENSED', licenseType: 'RIAD', taxRegime: 'PROPERTY_INCOME', taxeSejourMode: 'COLLECTED', ownerId: owners[0].id },
    });
    propertyId = ((await created.json()) as { id: string }).id;
    const csv = `check_in,check_out,platform,confirmation_code\n${iso(-1)},${iso(1)},DIRECT,P4-${runId}\n`;
    await api.post(`/api/properties/${propertyId}/imports`, { multipart: { file: { name: 'stay.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) } } });
    const arrivals = (await (await api.get(`/api/properties/${propertyId}/arrivals?days=30`)).json()) as { bookingId: string }[];
    const link = (await (await api.post(`/api/bookings/${arrivals[0].bookingId}/checkin-links`, { data: { maxGuests: 1 } })).json()) as { token: string };

    const guest = { 'X-Checkin-Token': link.token };
    const view = (await (await api.get('/api/checkin?lang=fr', { headers: guest })).json()) as { consent: { id: string } };
    const upload = await api.post('/api/checkin/document', { headers: guest, multipart: { file: { name: 'p.jpg', mimeType: 'image/jpeg', buffer: PASSPORT } } });
    const draftId = ((await upload.json()) as { draftId: string }).draftId;
    const submit = await api.post('/api/checkin/submit', {
      headers: guest,
      data: {
        draftId, consentTextId: view.consent.id, consent: true, docType: 'PASSPORT', fullName: guestName, nationality: 'SWE', docNumber: 'L898902C3', dob: '1974-08-12',
        declaredMoroccanNationality: false, entryStampNumber: 'CMN-2026-001', cityOfOrigin: 'Stockholm', nextDestination: 'Essaouira', profession: 'Ingénieure',
      },
    });
    expect(submit.status()).toBe(200);
    await api.dispose();
  });

  await test.step('the property page leads to the registers; the month shows one guest and one incomplete record', async () => {
    await login(page, 'manager@demo.dari.test');
    await page.goto(`/properties/${propertyId}`);
    await page.getByRole('link', { name: 'Registre de police' }).click();
    await expect(page.getByRole('heading', { name: 'Registre de police mensuel', level: 1 })).toBeVisible();
    await expect(page.getByText('Mise en forme indicative, à comparer au modèle officiel.')).toBeVisible();
    const card = page.locator('li', { has: page.getByRole('heading', { name: monthLabel }) });
    await expect(card.getByText('1 voyageur · 1 séjour')).toBeVisible();
    await expect(card.getByText('Non généré', { exact: true })).toBeVisible();
    await expect(card.getByText('1 enregistrement incomplet')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Ouvrir le PDF' })).toHaveCount(0); // nothing to open yet
    await expect(card.getByRole('button', { name: 'Partager' })).toHaveCount(0); // and nothing to share
  });

  await test.step('the report names the problem without a name or number, and leads to the guest', async () => {
    await page.getByRole('button', { name: 'Voir les enregistrements incomplets' }).click();
    const report = page.getByRole('dialog', { name: /Enregistrements incomplets/ });
    await expect(report.getByText('Envoyé par le voyageur, pas encore marqué comme vérifié.')).toBeVisible();
    expect(await report.textContent()).not.toContain(guestName);
    expect(await report.textContent()).not.toContain('L898902C3');
    await report.getByRole('button', { name: 'Ouvrir le voyageur' }).click();
    const guest = page.getByRole('dialog', { name: /Voyageur/ });
    await expect(guest.getByText(guestName)).toBeVisible();
    await guest.getByRole('button', { name: 'Marquer comme vérifié' }).click();
    await expect(guest.getByText('Marqué comme vérifié.')).toBeVisible();
    await guest.getByRole('button', { name: 'Annuler' }).first().click(); // the close button
    await page.getByRole('dialog', { name: /Enregistrements incomplets/ }).getByRole('button', { name: 'Fermer' }).click();
  });

  await test.step('the register is generated; the month is generated and has no incomplete record', async () => {
    const card = page.locator('li', { has: page.getByRole('heading', { name: monthLabel }) });
    await card.getByRole('button', { name: 'Générer le registre' }).click();
    await expect(page.getByText(`Le registre de ${monthLabel} a été généré.`)).toBeVisible();
    await expect(card.getByText('Généré', { exact: true })).toBeVisible();
    await expect(card.getByText('Aucun enregistrement incomplet trouvé')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Ouvrir le PDF' })).toBeVisible();
  });

  await test.step('a correction makes the register out of date, and it cannot be shared until regenerated', async () => {
    const api = await page.context().request;
    const arrivals = (await (await api.get(`/api/properties/${propertyId}/arrivals?days=30`)).json()) as { guests: { id: string }[] }[];
    const patch = await api.patch(`/api/guests/${arrivals[0].guests[0].id}`, { data: { profession: 'Architecte' }, headers: { 'X-Requested-With': 'dari' } });
    expect(patch.status()).toBe(200);
    await page.reload();
    const card = page.locator('li', { has: page.getByRole('heading', { name: monthLabel }) });
    await expect(card.getByText('À régénérer', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Partager' })).toHaveCount(0);
    await expect(card.getByText('Générez à nouveau le registre avant de le partager.')).toBeVisible();
    await card.getByRole('button', { name: 'Générer à nouveau' }).click();
    await expect(card.getByText('Généré', { exact: true })).toBeVisible();
  });

  await test.step('the link is shown once, within the allowed durations, with copy and WhatsApp', async () => {
    const card = page.locator('li', { has: page.getByRole('heading', { name: monthLabel }) });
    await card.getByRole('button', { name: 'Partager' }).click();
    const dialog = page.getByRole('dialog', { name: /Partager le registre/ });
    await expect(dialog.getByText('Entre 24 et 72 heures.')).toBeVisible(); // from RuleConfig, through the API
    await expect(dialog.getByLabel('Durée du lien, en heures')).toHaveValue('24');
    const create = dialog.getByRole('button', { name: 'Créer le lien' });
    await expect(create).toBeDisabled(); // a recipient is required
    await dialog.getByLabel('Durée du lien, en heures').fill('100');
    await dialog.getByLabel('Pour qui ?').fill('Préfecture de Marrakech');
    await create.click();
    await expect(dialog.getByText("La durée choisie n'est pas dans la plage autorisée.")).toBeVisible();
    await dialog.getByLabel('Durée du lien, en heures').fill('48');
    await create.click();

    await expect(dialog.getByText("il n'est affiché qu'une seule fois")).toBeVisible();
    shareUrl = await dialog.getByLabel('Lien', { exact: true }).inputValue();
    expect(shareUrl).toMatch(/^http:\/\/localhost:3000\/s#token=[A-Za-z0-9_-]{43}$/); // token in the fragment
    const href = (await dialog.getByRole('link', { name: 'Envoyer par WhatsApp' }).getAttribute('href')) ?? '';
    expect(decodeURIComponent(href)).toContain(shareUrl);
    expect(decodeURIComponent(href)).not.toContain('Préfecture'); // the label is the manager's reminder, not for the recipient
    await dialog.getByRole('button', { name: 'Copier le lien' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl);
  });

  await test.step('closing the dialog drops the token from the page and from every API response', async () => {
    const token = shareUrl.split('#token=')[1];
    await page.getByRole('dialog').getByRole('button', { name: 'Terminé' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.content()).not.toContain(token);
    const list = await page.context().request.get('/api/shares');
    expect(await list.text()).not.toContain(token);
    expect(await list.text()).not.toMatch(/"token"/);
  });

  await test.step('the recipient opens the link on a phone with no account: notice, document, no navigation, nothing stored', async () => {
    const token = shareUrl.split('#token=')[1];
    const visitor = await browser.newContext({ ...test.info().project.use, storageState: undefined });
    const authority = await visitor.newPage();
    const requests: { url: string; token: string | undefined }[] = [];
    authority.on('request', (r) => requests.push({ url: r.url(), token: r.headers()['x-share-token'] }));

    await authority.goto(shareUrl);
    await expect(authority.getByRole('heading', { name: 'Document confidentiel', level: 1 })).toBeVisible();
    await expect(authority.getByText('Chaque ouverture est enregistrée.')).toBeVisible();
    // The PDF is fetched with the token in a header and shown from an object URL made by the page.
    await expect(authority.locator('iframe')).toHaveAttribute('src', /^blob:/);
    expect(authority.url()).toBe('http://localhost:3000/s'); // the fragment is gone from the address bar
    expect(requests.filter((r) => r.url.includes(token))).toEqual([]); // no URL ever carried it
    expect(requests.filter((r) => r.url.endsWith('/api/share')).map((r) => r.token)).toEqual([token]);
    expect(await authority.content()).not.toContain(token);
    await expect(authority.getByRole('link', { name: 'Ouvrir dans un nouvel onglet' })).toHaveAttribute('rel', /noopener/);
    await expect(authority.getByRole('navigation')).toHaveCount(0); // no way into the app
    expect(await visitor.cookies()).toEqual([]); // no cookie, no session
    await visitor.close();
  });

  await test.step('the manager sees the opening in the access log, without an address', async () => {
    await page.goto('/shares');
    const card = page.locator('li', { has: page.getByText('Pour : Préfecture de Marrakech') }).first();
    await expect(card.getByText('Ouvert 1 fois')).toBeVisible();
    await card.getByRole('button', { name: "Journal d'accès" }).click();
    const log = page.getByRole('dialog', { name: 'Qui a ouvert ce lien' });
    await expect(log.getByText(/Chrome|Mozilla/)).toBeVisible();
    await expect(log.getByText(/\b\d{1,3}(\.\d{1,3}){3}\b/)).toHaveCount(0);
    await log.getByRole('button', { name: 'Fermer' }).click();
  });

  await test.step('the shares screen lists the link; the manager revokes it', async () => {
    await page.goto('/shares');
    await expect(page.getByRole('heading', { name: 'Liens partagés', level: 1 })).toBeVisible();
    const card = page.locator('li', { has: page.getByText('Pour : Préfecture de Marrakech') }).first();
    await expect(card.getByText(`Registre de police ${monthLabel}`)).toBeVisible();
    await expect(card.getByText(propertyName)).toBeVisible();
    await expect(card.getByText(/Actif jusqu'au/)).toBeVisible();
    await expect(card.getByText('Ouvert 1 fois')).toBeVisible();
    await card.getByRole('button', { name: 'Révoquer' }).click();
    await page.getByRole('dialog', { name: 'Révoquer ce lien ?' }).getByRole('button', { name: 'Révoquer le lien' }).click();
    await expect(page.getByText('Lien révoqué.', { exact: true })).toBeVisible();
    await expect(card.getByText('Révoqué', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Révoquer' })).toHaveCount(0);
  });

  await test.step('the same link now shows the neutral page, identical to an unknown link', async () => {
    const visit = async (url: string) => {
      const ctx = await browser.newContext({ ...test.info().project.use, storageState: undefined });
      const p = await ctx.newPage();
      await p.goto(url);
      await expect(p.getByRole('heading', { name: "Ce lien n'est pas disponible", level: 1 })).toBeVisible();
      const text = await p.locator('main').innerText();
      await expect(p.locator('iframe')).toHaveCount(0);
      await ctx.close();
      return text;
    };
    const revoked = await visit(shareUrl);
    const unknown = await visit('http://localhost:3000/s#token=' + 'A'.repeat(43));
    const none = await visit('http://localhost:3000/s');
    expect(revoked).toBe(unknown);
    expect(none).toBe(unknown);
    // The manager's count did not move: a refused visit records nothing.
    await page.goto('/shares');
    await expect(page.locator('li', { has: page.getByText('Pour : Préfecture de Marrakech') }).first().getByText('Ouvert 1 fois')).toBeVisible();
  });
});

test('Staff see which months have a register and nothing else; the Accountant has no access', async ({ page, browser }) => {
  await login(page, 'staff@demo.dari.test');
  await page.goto(`/properties/${propertyId}/registers`);
  await expect(page.getByText('Le registre lui-même est visible par le gestionnaire uniquement.')).toBeVisible();
  const card = page.locator('li', { has: page.getByRole('heading', { name: monthLabel }) });
  await expect(card.getByText('Généré', { exact: true })).toBeVisible();
  for (const name of ['Générer à nouveau', 'Ouvrir le PDF', 'Partager']) await expect(page.getByRole('button', { name })).toHaveCount(0);
  await expect(card.getByText(/voyageur/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Liens partagés' })).toHaveCount(0);
  await page.goto('/shares');
  await expect(page).toHaveURL(/\/dashboard$/);

  const accountant = await (await browser.newContext({ ...test.info().project.use })).newPage();
  await login(accountant, 'accountant@demo.dari.test');
  await accountant.goto(`/properties/${propertyId}/registers`);
  await expect(accountant).toHaveURL(/\/reports$/);
  await accountant.context().close();
});
