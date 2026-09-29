import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, Page, test } from '@playwright/test';

/**
 * Phase 3, manager and Staff side, on a phone: a stay arrives, a check-in link is sent (shown once, by WhatsApp or
 * copy), revoked; Staff see status only; the Accountant has no access. Uses the demo account created by
 * `npm run db:seed` (one user per role, the development consent text).
 */
const PASSWORD = 'demo-password-123';
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function openArrivals(page: Page) {
  await page.goto('/properties');
  await page.getByRole('link', { name: /Riad Demo/ }).first().click();
  await page.getByRole('link', { name: 'Arrivées et enregistrement' }).click();
  await expect(page.getByRole('heading', { name: 'Arrivées et enregistrement', level: 1 })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

let stay: { checkIn: string; checkOut: string };

test('the manager imports a stay and sends a check-in link that is shown once', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  stay = { checkIn: iso(9), checkOut: iso(12) };

  await test.step('a stay is imported', async () => {
    await login(page, 'manager@demo.dari.test');
    await page.goto('/properties');
    await page.getByRole('link', { name: /Riad Demo/ }).first().click();
    await page.getByRole('link', { name: 'Importer des séjours' }).click();
    const csv = `check_in,check_out,platform,confirmation_code\n${stay.checkIn},${stay.checkOut},DIRECT,P3-${Date.now()}\n`;
    await page.getByLabel('Fichier CSV').setInputFiles({ name: 'stays.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByRole('button', { name: 'Vérifier le fichier' }).click();
    await page.getByRole('button', { name: 'Importer 1 séjour' }).click();
    await expect(page.getByText('1 séjour importé')).toBeVisible();
  });

  await test.step('the arrivals screen shows the stay with no link yet', async () => {
    await openArrivals(page);
    // "Send link" (not "Send a new link") exists only on a stay that has never had a link.
    await expect(page.getByRole('button', { name: 'Envoyer le lien' }).first()).toBeVisible();
    await expect(page.getByText('Aucun lien envoyé', { exact: true }).first()).toBeVisible();
  });

  let url = '';
  await test.step('the link is created and shown once, with copy and WhatsApp', async () => {
    await page.getByRole('button', { name: 'Envoyer le lien' }).first().click();
    const dialog = page.getByRole('dialog', { name: "Envoyer le lien d'enregistrement" });
    await dialog.getByLabel('Nombre de voyageurs du groupe').fill('2');
    await dialog.getByRole('button', { name: 'Créer le lien' }).click();

    await expect(dialog.getByText("il n'est affiché qu'une seule fois")).toBeVisible();
    const field = dialog.getByLabel('Lien du voyageur');
    url = await field.inputValue();
    // The token is in the fragment: no server, log or link-preview bot ever receives it.
    expect(url).toMatch(/^http:\/\/localhost:3000\/checkin#token=[A-Za-z0-9_-]{43}$/);

    const whatsapp = dialog.getByRole('link', { name: 'Envoyer par WhatsApp' });
    const href = (await whatsapp.getAttribute('href')) ?? '';
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    const message = decodeURIComponent(href.slice('https://wa.me/?text='.length));
    expect(message).toContain('Riad Demo');
    expect(message).toContain(url);
    expect(message).toContain('Bonjour'); // written in the guest's language
    await expect(whatsapp).toHaveAttribute('rel', /noopener/);

    // The same message in English, without changing the manager's interface language.
    await dialog.getByRole('button', { name: 'English' }).click();
    expect(decodeURIComponent(((await whatsapp.getAttribute('href')) ?? '').slice(20))).toContain('please fill in your check-in form');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

    await dialog.getByRole('button', { name: 'Copier le lien' }).click();
    await expect(dialog.getByRole('button', { name: 'Copié' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  });

  await test.step('closing the dialog drops the token: it is nowhere on the page or in the API responses again', async () => {
    const token = url.split('#token=')[1];
    await page.getByRole('dialog').getByRole('button', { name: 'Terminé' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.content()).not.toContain(token);
    // Nor does the API ever return it again: the listing of this booking's links has no token.
    const propertyId = page.url().match(/properties\/([0-9a-f-]{36})/)![1];
    const arrivals = (await (await page.request.get(`/api/properties/${propertyId}/arrivals`)).json()) as { bookingId: string; checkIn: string }[];
    const booking = arrivals.find((a) => a.checkIn === stay.checkIn)!;
    const links = await page.request.get(`/api/bookings/${booking.bookingId}/checkin-links`);
    expect(links.status()).toBe(200);
    expect(await links.text()).not.toContain(token);
    expect(await links.text()).not.toMatch(/token/i);
    await expect(page.getByText('Lien envoyé', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Révoquer le lien' }).first()).toBeVisible();
  });

  await test.step('the manager revokes the link', async () => {
    await page.getByRole('button', { name: 'Révoquer le lien' }).first().click();
    await page.getByRole('dialog', { name: 'Révoquer ce lien ?' }).getByRole('button', { name: 'Révoquer le lien' }).click();
    await expect(page.getByText('Lien révoqué.', { exact: true })).toBeVisible();
    await expect(page.getByText('Lien révoqué', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Envoyer un nouveau lien' }).first()).toBeVisible();
  });
});

test('Staff see the status and can send links; the Accountant has no access', async ({ page, browser }) => {
  await login(page, 'staff@demo.dari.test');
  await openArrivals(page);
  await expect(page.getByText('Les informations des voyageurs sont visibles par le gestionnaire uniquement.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Envoyer (un nouveau )?lien|Envoyer le lien/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ouvrir' })).toHaveCount(0); // no guest details for Staff

  const accountant = await (await browser.newContext({ ...test.info().project.use })).newPage();
  await login(accountant, 'accountant@demo.dari.test');
  await accountant.goto('/properties');
  await expect(accountant).toHaveURL(/\/reports$/);
  await accountant.context().close();
});

/** A fictional traveller (generated data, no real document): the ICAO check digits are computed, nothing else is real. */
const PASSPORT = readFileSync(join(__dirname, 'fixtures', 'synthetic-passport.jpg'));

test('a guest checks in from a phone with a synthetic passport, and the manager gets the Fiche', async ({ page, browser, playwright }) => {
  const runId = Date.now().toString(36);
  const guestName = `Anna Test ${runId}`;

  // ---- The manager prepares a stay and a link (through the API: the screens for this are covered above).
  const api = await playwright.request.newContext({ baseURL: 'http://localhost:3000', extraHTTPHeaders: { 'X-Requested-With': 'dari' } });
  await api.post('/api/auth/login', { data: { email: 'manager@demo.dari.test', password: PASSWORD } });
  const properties = (await (await api.get('/api/properties')).json()) as { id: string; name: string }[];
  const propertyId = properties.find((p) => p.name === 'Riad Demo')!.id;
  const csv = `check_in,check_out,platform,confirmation_code\n${iso(14)},${iso(17)},DIRECT,P3G-${runId}\n`;
  await api.post(`/api/properties/${propertyId}/imports`, { multipart: { file: { name: 'stay.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) } } });
  const arrivals = (await (await api.get(`/api/properties/${propertyId}/arrivals?days=60`)).json()) as { bookingId: string; checkIn: string; guests: unknown[] }[];
  const bookingId = arrivals.find((a) => a.checkIn === iso(14) && a.guests.length === 0)!.bookingId;
  const link = (await (await api.post(`/api/bookings/${bookingId}/checkin-links`, { data: { maxGuests: 1 } })).json()) as { url: string; token: string; id: string };

  // ---- The guest, on a phone with no account: opens the link, photographs the passport, sends.
  const guestContext = await browser.newContext({ ...test.info().project.use });
  const guest = await guestContext.newPage();
  const startedAt = Date.now();

  await test.step('the link opens the intro; the token leaves the address bar and is never in a request URL', async () => {
    const urls: string[] = [];
    guest.on('request', (r) => urls.push(r.url()));
    await guest.goto(link.url);
    await expect(guest.getByRole('heading', { name: 'Enregistrez-vous avant votre arrivée' })).toBeVisible();
    await expect(guest.getByText('Votre séjour à Riad Demo')).toBeVisible();
    expect(guest.url()).toBe('http://localhost:3000/checkin'); // fragment removed
    expect(urls.filter((u) => u.includes(link.token))).toEqual([]); // no URL ever carried it
    await expect(guest.getByRole('link')).toHaveCount(0); // no navigation, no way into the app
    await guest.getByRole('button', { name: 'Commencer' }).click();
  });

  await test.step('the passport photo is read: fields are prefilled and editable', async () => {
    await expect(guest.getByRole('heading', { name: 'Photographiez votre pièce' })).toBeVisible();
    await guest.getByTestId('take-photo').setInputFiles({ name: 'passport.jpg', mimeType: 'image/jpeg', buffer: PASSPORT });
    await expect(guest.getByRole('heading', { name: 'Vérifiez vos informations' })).toBeVisible({ timeout: 30_000 });
    await expect(guest.getByText('Nous avons lu votre pièce. Vérifiez chaque champ ci-dessous.')).toBeVisible();
    await expect(guest.getByLabel('Nom et prénoms')).toHaveValue('ANNA MARIA ERIKSSON');
    await expect(guest.getByLabel('Numéro de la pièce')).toHaveValue('L898902C3');
    await expect(guest.getByLabel('Date de naissance')).toHaveValue('1974-08-12');
    await expect(guest.getByLabel('Nationalité')).toHaveValue('SWE');
    // The guest corrects a field: OCR is only a suggestion.
    await guest.getByLabel('Nom et prénoms').fill(guestName);
  });

  await test.step('the server-side mandatory fields, the nationality question and consent cannot be skipped', async () => {
    await guest.getByRole('button', { name: 'Envoyer' }).click();
    await expect(guest.getByText('Certains champs demandent votre attention.').first()).toBeVisible();
    for (const label of ["Numéro du cachet d'entrée", 'Ville de provenance', 'Prochaine destination', 'Profession']) {
      await expect(guest.getByLabel(label)).toHaveAttribute('aria-invalid', 'true');
    }
    await expect(guest.getByText('Obligatoire.').first()).toBeVisible();
  });

  await test.step('the four fields, the question and the consent (text directly above the button) are completed', async () => {
    await guest.getByLabel("Numéro du cachet d'entrée").fill('CMN-2026-001');
    await guest.getByLabel('Ville de provenance').fill('Stockholm');
    await guest.getByLabel('Prochaine destination').fill('Essaouira');
    await guest.getByLabel('Profession').fill('Ingénieure');
    await guest.getByLabel('Non', { exact: true }).check();

    const consent = guest.getByTestId('consent-text');
    await expect(consent).toContainText('TEXTE DE DÉVELOPPEMENT'); // the seeded development wording, in French
    const send = guest.getByRole('button', { name: 'Envoyer' });
    const gap = (await send.boundingBox())!.y - ((await consent.boundingBox())!.y + (await consent.boundingBox())!.height);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(200); // the consent block is immediately above the send button, nothing else between

    await send.click(); // still without the consent box
    await expect(guest.getByText('Obligatoire.').last()).toBeVisible();
    await guest.getByLabel("J'ai lu le texte ci-dessus et j'accepte.").check();
    await send.click();
    await expect(guest.getByRole('heading', { name: 'Merci' })).toBeVisible({ timeout: 30_000 });
    await expect(guest.getByText('Vous pouvez fermer cette page.')).toBeVisible();
  });

  expect(Date.now() - startedAt).toBeLessThan(120_000); // definition of done: under two minutes on a phone

  await test.step('the link is now used up: reopening it shows the neutral unavailable page', async () => {
    const again = await guestContext.newPage();
    await again.goto(link.url);
    await expect(again.getByRole('heading', { name: "Ce lien n'est pas disponible" })).toBeVisible();
  });

  // ---- The manager: status, details, the Fiche and (audited) the image.
  const guestId = await test.step('the manager sees the guest and their status', async () => {
    let id = '';
    await expect
      .poll(async () => {
        const list = (await (await api.get(`/api/properties/${propertyId}/arrivals?days=60`)).json()) as { bookingId: string; checkinStatus: string; guests: { id: string; hasFiche: boolean }[] }[];
        const mine = list.find((a) => a.bookingId === bookingId);
        id = mine?.guests[0]?.id ?? '';
        return mine ? `${mine.checkinStatus}:${mine.guests[0]?.hasFiche}` : '';
      }, { timeout: 45_000, message: 'the Fiche PDF is generated after the guest submits' })
      .toBe('COMPLETE:true');
    return id;
  });

  await test.step('the manager opens the guest: fields, the OCR correction note, the Fiche PDF and the ID image', async () => {
    await login(page, 'manager@demo.dari.test');
    await page.goto(`/properties/${propertyId}/arrivals`);
    await page.getByRole('listitem').filter({ hasText: guestName }).getByRole('button', { name: 'Ouvrir' }).click();
    const dialog = page.getByRole('dialog', { name: /Voyageur/ });
    await expect(dialog.getByText(guestName)).toBeVisible();
    await expect(dialog.getByText('L898902C3')).toBeVisible();
    await expect(dialog.getByText('Stockholm')).toBeVisible();
    await expect(dialog.getByText(/Corrigé par le voyageur après la lecture du document : .*Nom et prénoms/)).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Télécharger la fiche' }).click()]);
    const pdf = readFileSync((await download.path())!);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);
    expect(download.suggestedFilename()).toBe('fiche-de-police.pdf'); // no name in the file name

    await dialog.getByRole('button', { name: "Voir l'image de la pièce" }).click();
    const image = page.getByRole('img', { name: 'Pièce d\'identité du voyageur' });
    await expect(image).toBeVisible();
    expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth > 400)).toBe(true);
    expect(await image.getAttribute('src')).toMatch(/^blob:/); // a local object URL, never a link to the server
  });

  await test.step('the image is served only by the API, decrypted, with no-store (every read is audited: see the integration tests)', async () => {
    const res = await api.get(`/api/guests/${guestId}/document`);
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toBe('no-store');
    expect(res.headers()['content-type']).toBe('image/jpeg');
  });

  await test.step('Staff see the status only: no name, no image, no Fiche', async () => {
    const staff = await playwright.request.newContext({ baseURL: 'http://localhost:3000', extraHTTPHeaders: { 'X-Requested-With': 'dari' } });
    await staff.post('/api/auth/login', { data: { email: 'staff@demo.dari.test', password: PASSWORD } });
    expect((await staff.get(`/api/guests/${guestId}/document`)).status()).toBe(403);
    expect((await staff.get(`/api/guests/${guestId}/fiche`)).status()).toBe(403);
    const view = (await (await staff.get(`/api/guests/${guestId}`)).json()) as Record<string, unknown>;
    expect(view.fields).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain(guestName);

    const staffPage = await (await browser.newContext({ ...test.info().project.use })).newPage();
    await login(staffPage, 'staff@demo.dari.test');
    await staffPage.goto(`/properties/${propertyId}/arrivals`);
    await expect(staffPage.getByText(guestName)).toHaveCount(0);
    await expect(staffPage.getByText('Voyageur 1').first()).toBeVisible();
    await expect(staffPage.getByRole('button', { name: 'Ouvrir' })).toHaveCount(0);
    await staffPage.context().close();
    await staff.dispose();
  });

  await guestContext.close();
  await api.dispose();
});
