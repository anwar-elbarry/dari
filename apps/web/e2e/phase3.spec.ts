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
