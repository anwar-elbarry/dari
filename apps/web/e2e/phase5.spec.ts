import { readFileSync } from 'node:fs';
import { APIRequestContext, Browser, BrowserContext, expect, PlaywrightWorkerArgs, test } from '@playwright/test';

/**
 * Phase 5, on a phone: the manager opens the tax estimate of a property, sees the red BETA banner (the demo
 * rules are unvalidated), enters the amounts of a stay through the missing-data dialog, generates a month,
 * reads the lines (the local tax is "not computed": no rule for it in the seed), opens the detail, and downloads
 * the exports. The Accountant (one sign-in per role) sees the report with the banner and can open the detail,
 * but has no property routes and no Generate button; Staff see none of it. Uses the demo account from
 * `npm run db:seed` and a property of its own, so other specs do not change the figures.
 *
 * The wording of the banner comes from RuleConfig through the API; the strings below are the migration's beta
 * defaults (20260930120000_phase5_tax_report_model) and change with that data, not with the app.
 */
const PASSWORD = 'demo-password-123';
const BANNER_FR = 'ESTIMATION BÊTA - NON VÉRIFIÉE';
const BANNER_EN = 'BETA ESTIMATE - UNVERIFIED';

/** See phase4.spec.ts: sign-in is limited per address, so each role signs in ONCE through the API. */
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

test.describe.configure({ mode: 'serial' });

const runId = Date.now().toString(36);
const propertyName = `Riad Fiscal ${runId}`;
/** A stay inside the previous calendar month, so the month is over and every "stay month" rule gives the same month. */
const now = new Date();
const stayMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const month = stayMonth.toISOString().slice(0, 7);
const monthLabel = new Intl.DateTimeFormat('fr', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(stayMonth);
const monthLabelEn = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(stayMonth);
let propertyId: string;
let bookingId: string;
let reportId: string;

const card = (page: import('@playwright/test').Page) => page.locator('li', { has: page.getByRole('heading', { name: monthLabel, level: 2 }) });

test('the manager sees the beta banner, enters amounts, generates a month and reads the lines', async ({ playwright, browser }) => {
  test.setTimeout(180_000);
  const api = await signIn(playwright, 'manager@demo.dari.test');
  const context = await browserAs(browser, api);
  const page = await context.newPage();

  await test.step('a property and a stay of the previous month, without amounts (through the API)', async () => {
    const owners = (await (await api.get('/api/property-owners')).json()) as { id: string }[];
    const created = await api.post('/api/properties', {
      data: { name: propertyName, address: '4 Derb Fiscal', commune: 'Marrakech', licenseStatus: 'LICENSED', licenseType: 'RIAD', taxRegime: 'PROPERTY_INCOME', taxeSejourMode: 'COLLECTED', ownerId: owners[0].id },
    });
    propertyId = ((await created.json()) as { id: string }).id;
    const csv = `check_in,check_out,platform,confirmation_code\n${month}-10,${month}-12,DIRECT,P5-${runId}\n`;
    const imported = await api.post(`/api/properties/${propertyId}/imports`, { multipart: { file: { name: 'stay.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) } } });
    expect(imported.ok()).toBe(true);
    const stays = (await (await api.get(`/api/properties/${propertyId}/bookings?from=${month}-01&to=${month}-28`)).json()) as { id: string }[];
    expect(stays).toHaveLength(1);
    bookingId = stays[0].id;
  });

  await test.step('the property page leads to the tax estimate; the banner is loud and carries the full text', async () => {
    await page.goto(`/properties/${propertyId}`);
    await page.getByRole('link', { name: 'Estimation fiscale', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Estimation fiscale mensuelle', level: 1 })).toBeVisible();
    const banner = page.getByTestId('tax-beta-banner');
    await expect(banner).toBeVisible();
    await expect(banner.getByText(BANNER_FR, { exact: true })).toBeVisible();
    await expect(banner.getByText(/n'a PAS été validée par un expert-comptable agréé/)).toBeVisible();
    // Unmissable: a 2px border in the danger colour, not a soft notice.
    expect(await banner.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('2px');
    // Never a word that claims the figures are right.
    expect((await page.locator('main').innerText()).toLowerCase()).not.toMatch(/certifi|garanti|conforme/);
    await expect(page.getByText('Revenus fonciers (particulier)')).toBeVisible();
    await expect(page.getByText('Encaissée auprès du voyageur')).toBeVisible();
    await expect(card(page).getByText('Non générée', { exact: true })).toBeVisible();
    await expect(card(page).getByRole('button', { name: 'Ouvrir le PDF' })).toHaveCount(0); // nothing to open yet
    await expect(card(page).getByRole('button', { name: 'Télécharger Excel' })).toHaveCount(0);
  });

  await test.step('the missing-data dialog names the stay by its dates and the missing parameter, and no guest', async () => {
    await card(page).getByRole('button', { name: 'Données manquantes' }).click();
    const dialog = page.getByRole('dialog', { name: /Données manquantes, / });
    await expect(dialog.getByRole('heading', { name: 'Séjours sans montants' })).toBeVisible();
    await expect(dialog.getByText(/Séjour du .+ au .+/)).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Paramètres manquants ou non validés' })).toBeVisible();
    expect(await dialog.textContent()).not.toMatch(/undefined|NaN/);
  });

  await test.step('amounts are entered as text: an invalid one is refused inline, then all are saved', async () => {
    const missing = page.getByRole('dialog', { name: /Données manquantes, / });
    await missing.getByRole('button', { name: 'Saisir les montants' }).click();
    const dialog = page.getByRole('dialog', { name: 'Montants du séjour' });
    await expect(dialog.getByLabel('Nuitées', { exact: true })).toBeVisible();
    for (const [label, value] of [
      ['Nuitées', '1500,00'],
      ['Frais de ménage facturés', '200'],
      ['Services additionnels', '100'],
      ['Remises', '50'],
      ['Remboursements', '12.345'], // three decimals: refused
      ['Nombre de voyageurs', '2'],
    ] as const) {
      await dialog.getByLabel(label, { exact: true }).fill(value);
    }
    await expect(dialog.getByLabel('Nuitées', { exact: true })).toHaveCSS('min-height', '44px');
    await dialog.getByRole('button', { name: 'Enregistrer les montants' }).click();
    await expect(dialog.getByText('Montant invalide : chiffres seulement, deux décimales au plus.')).toBeVisible();
    await expect(dialog.getByLabel('Remboursements', { exact: true })).toHaveAttribute('aria-invalid', 'true');

    await dialog.getByLabel('Remboursements', { exact: true }).fill('0');
    await dialog.getByRole('button', { name: 'Enregistrer les montants' }).click();
    await expect(page.getByRole('dialog', { name: 'Montants du séjour' })).toHaveCount(0);
    await expect(page.getByText('Montants enregistrés.')).toBeVisible();
    // The list of missing data is reloaded: the stay is gone from it, the missing parameter is still there.
    await expect(missing.getByRole('heading', { name: 'Séjours sans montants' })).toHaveCount(0);
    await expect(missing.getByRole('heading', { name: 'Paramètres manquants ou non validés' })).toBeVisible();
    await missing.getByRole('button', { name: 'Fermer' }).click();
  });

  await test.step('the amounts are stored as decimals and come back as text', async () => {
    const stay = ((await (await api.get(`/api/properties/${propertyId}/bookings?from=${month}-01&to=${month}-28`)).json()) as Record<string, string | number | null>[])[0];
    expect(Number(stay.nightlyRevenue)).toBe(1500);
    expect(typeof stay.nightlyRevenue).toBe('string');
    expect(Number(stay.discounts)).toBe(50);
    expect(stay.partySize).toBe(2);
  });

  await test.step('generating the month says what is missing and shows the dialog by itself', async () => {
    await card(page).getByRole('button', { name: "Générer l'estimation" }).click();
    await expect(page.getByText(new RegExp(`L'estimation de ${monthLabel} a été générée avec 1 donnée manquante`))).toBeVisible();
    const dialog = page.getByRole('dialog', { name: /Données manquantes, / });
    await expect(dialog.getByRole('heading', { name: 'Paramètres manquants ou non validés' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Fermer' }).click();
    await expect(card(page).getByText('Générée', { exact: true })).toBeVisible();
    await expect(card(page).getByText('Bêta', { exact: true })).toBeVisible();
    await expect(card(page).getByText('1 donnée manquante')).toBeVisible();
    await expect(card(page).getByRole('button', { name: 'Ouvrir le PDF' })).toBeVisible();
    await expect(card(page).getByRole('button', { name: 'Télécharger Excel' })).toBeVisible();
  });

  await test.step('the PDF opens and the Excel file downloads under a name without personal data', async () => {
    const opened = Promise.race([context.waitForEvent('page'), page.waitForEvent('download')]);
    await card(page).getByRole('button', { name: 'Ouvrir le PDF' }).click();
    await opened; // a tab or, where the browser has no PDF viewer, a download: either way the file arrived

    const [download] = await Promise.all([page.waitForEvent('download'), card(page).getByRole('button', { name: 'Télécharger Excel' }).click()]);
    expect(download.suggestedFilename()).toBe(`estimation-fiscale-riad-fiscal-${runId}-${month}.xlsx`);
    expect(readFileSync((await download.path())!).subarray(0, 2).toString()).toBe('PK'); // an .xlsx is a zip

    const list = (await (await api.get('/api/tax/reports')).json()) as { id: string; propertyId: string }[];
    reportId = list.find((r) => r.propertyId === propertyId)!.id;
    const pdf = await api.get(`/api/tax/reports/${reportId}/pdf`);
    expect(pdf.headers()['cache-control']).toContain('no-store');
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
  });

  await test.step('the detail shows the lines: figures from the digits, the local tax not computed', async () => {
    await card(page).getByRole('link', { name: 'Voir le détail' }).click();
    await expect(page).toHaveURL(new RegExp(`/tax/reports/${reportId}$`));
    await expect(page.getByRole('heading', { name: `Estimation fiscale, ${monthLabel}`, level: 1 })).toBeVisible();
    await expect(page.getByTestId('tax-beta-banner').getByText(BANNER_FR, { exact: true })).toBeVisible();

    const row = (name: RegExp) => page.getByRole('row').filter({ has: page.getByRole('rowheader', { name }) });
    await expect(row(/^Revenus des nuitées/)).toContainText(/1\s650,00 MAD/); // 1500 + 200 - 50 - 0
    await expect(row(/^Services additionnels/)).toContainText(/100,00 MAD/);
    await expect(row(/^Taxe de séjour déduite/)).toContainText('Sans objet');
    await expect(row(/^Base brute/)).toContainText(/1\s750,00 MAD/);
    await expect(row(/^Impôt sur le revenu/)).toContainText(/175,00 MAD/);
    await expect(row(/^Impôt sur le revenu/)).toContainText(/Taux 10 %/); // the rate is a parameter shown as text, from basis points
    await expect(row(/^TVA/)).toContainText('Sans objet');
    await expect(row(/^Taxes locales/)).toContainText('Non calculé');
    await expect(row(/^Taxes locales/)).toContainText('Non calculé : paramètre manquant');
    await expect(row(/^Taxes locales/)).not.toContainText('MAD'); // a missing parameter is never shown as zero

    await expect(page.getByText('Paramètres manquants : 1')).toBeVisible();
    await expect(page.getByText('Non validé', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Compléter les données' })).toHaveAttribute('href', `/properties/${propertyId}/tax`);
    await expect(page.getByRole('link', { name: 'Mois du bien' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ouvrir le PDF' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Télécharger Excel' })).toBeVisible();
    expect(await page.locator('main').innerText()).not.toMatch(/NaN|undefined|null/);
  });

  await test.step('in English: the banner text and the figures follow the language', async () => {
    await page.getByRole('button', { name: 'en', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Tax estimate, ${monthLabelEn}`, level: 1 })).toBeVisible();
    await expect(page.getByTestId('tax-beta-banner').getByText(BANNER_EN, { exact: true })).toBeVisible();
    await expect(page.getByTestId('tax-beta-banner').getByText(/has NOT been validated by a licensed accountant/)).toBeVisible();
    await expect(page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^Gross base/ }) })).toContainText('1,750.00 MAD');
    await expect(page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^Local taxes/ }) })).toContainText('Not computed');
    await page.getByRole('button', { name: 'fr', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Estimation fiscale, ${monthLabel}`, level: 1 })).toBeVisible();
  });

  await test.step('the list of all estimates shows the month with its banner and figures', async () => {
    await page.getByRole('link', { name: 'Estimations fiscales' }).click(); // the navigation entry
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByTestId('tax-beta-banner')).toBeVisible();
    const row = page.locator('li', { has: page.getByRole('heading', { name: propertyName, level: 3 }) });
    await expect(row.getByText('Bêta', { exact: true })).toBeVisible();
    await expect(row.getByText(/1\s750,00 MAD/)).toBeVisible(); // gross base
    await expect(row.getByText(/175,00 MAD/)).toBeVisible(); // the taxes computed so far
    await expect(row.getByText('Certaines lignes ne sont pas calculées : ce total est incomplet.')).toBeVisible();
    await expect(page.getByRole('heading', { name: monthLabel, level: 2 })).toBeVisible();
  });

  await test.step('a change after generating makes the estimate out of date, and generating again fixes it', async () => {
    const changed = await api.patch(`/api/bookings/${bookingId}/amounts`, { data: { discounts: '60.50' } });
    expect(changed.status()).toBe(200);
    await page.goto(`/properties/${propertyId}/tax`);
    await expect(card(page).getByText('À régénérer', { exact: true })).toBeVisible();
    await expect(card(page).getByText('Les données ont changé après la génération de cette estimation.')).toBeVisible();
    await card(page).getByRole('button', { name: 'Générer à nouveau' }).click();
    await page.getByRole('dialog', { name: /Données manquantes, / }).getByRole('button', { name: 'Fermer' }).click();
    await expect(card(page).getByText('Générée', { exact: true })).toBeVisible();
    await card(page).getByRole('link', { name: 'Voir le détail' }).click();
    await expect(page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^Base brute/ }) })).toContainText(/1\s739,50 MAD/); // 1750 - 10.50
  });
});

test('the Accountant reads the estimate with its banner and cannot reach a property or generate; Staff see none of it', async ({ playwright, browser }) => {
  test.setTimeout(240_000);
  const accountantApi = await signIn(playwright, 'accountant@demo.dari.test');
  const accountant = await (await browserAs(browser, accountantApi)).newPage();

  await test.step('the landing page is the list of estimates; the navigation has that one entry', async () => {
    await accountant.goto('/');
    await expect(accountant).toHaveURL(/\/reports$/);
    await expect(accountant.getByRole('heading', { name: 'Estimations fiscales', level: 1 })).toBeVisible();
    await expect(accountant.getByTestId('tax-beta-banner').getByText(BANNER_FR, { exact: true })).toBeVisible();
    const nav = accountant.getByRole('navigation', { name: 'Menu' });
    await expect(nav.getByRole('link')).toHaveText(['Estimations fiscales']);
    await expect(accountant.getByRole('button', { name: /Générer/ })).toHaveCount(0);
    await expect(accountant.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
    await expect(accountant.getByRole('group', { name: 'Langue' })).toBeVisible();
  });

  await test.step('the report is on the list and opens; no way back to the property, no Generate', async () => {
    const row = accountant.locator('li', { has: accountant.getByRole('heading', { name: propertyName, level: 3 }) });
    await expect(row.getByText('Bêta', { exact: true })).toBeVisible();
    await row.getByRole('link', { name: 'Voir le détail' }).click();
    await expect(accountant).toHaveURL(new RegExp(`/tax/reports/${reportId}$`));
    await expect(accountant.getByRole('heading', { name: `Estimation fiscale, ${monthLabel}`, level: 1 })).toBeVisible();
    await expect(accountant.getByTestId('tax-beta-banner').getByText(BANNER_FR, { exact: true })).toBeVisible();
    await expect(accountant.getByRole('row').filter({ has: accountant.getByRole('rowheader', { name: /^Base brute/ }) })).toContainText(/1\s739,50 MAD/);
    await expect(accountant.getByRole('button', { name: 'Ouvrir le PDF' })).toBeVisible();
    await expect(accountant.getByRole('button', { name: 'Télécharger Excel' })).toBeVisible();
    await expect(accountant.getByRole('link', { name: 'Mois du bien' })).toHaveCount(0);
    await expect(accountant.getByRole('link', { name: 'Compléter les données' })).toHaveCount(0);
    await expect(accountant.getByRole('button', { name: /Générer/ })).toHaveCount(0);
  });

  await test.step('property routes send the Accountant back to the reports', async () => {
    for (const path of [`/properties/${propertyId}/tax`, `/properties/${propertyId}`, '/properties', '/dashboard', '/shares']) {
      await accountant.goto(path);
      await expect(accountant).toHaveURL(/\/reports$/);
    }
  });

  await test.step('the API agrees: reports only, and no booking ids in what the Accountant receives', async () => {
    for (const path of ['/api/properties', `/api/properties/${propertyId}/bookings`, `/api/properties/${propertyId}/tax-reports`, `/api/properties/${propertyId}/tax-reports/${month}/missing`, `/api/properties/${propertyId}/arrivals`]) {
      expect((await accountantApi.get(path)).status(), path).toBe(403);
    }
    expect((await accountantApi.post(`/api/properties/${propertyId}/tax-reports/${month}`)).status()).toBe(403);
    expect((await accountantApi.patch(`/api/bookings/${bookingId}/amounts`, { data: { discounts: '1' } })).status()).toBe(403);
    const list = await accountantApi.get('/api/tax/reports');
    expect(list.status()).toBe(200);
    const body = await list.text();
    expect(body).not.toContain(bookingId);
    expect(body).not.toContain(`P5-${runId}`);
    expect((JSON.parse(body) as { problems?: unknown }[]).every((r) => r.problems === undefined)).toBe(true);
    expect((await accountantApi.get(`/api/tax/reports/${reportId}/xlsx`)).status()).toBe(200);
  });

  const staffApi = await signIn(playwright, 'staff@demo.dari.test');
  const staff = await (await browserAs(browser, staffApi)).newPage();

  await test.step('Staff have no entry, no page and no data', async () => {
    await staff.goto(`/properties/${propertyId}`);
    await expect(staff.getByRole('heading', { name: propertyName, level: 1 })).toBeVisible();
    await expect(staff.getByRole('link', { name: 'Estimation fiscale', exact: true })).toHaveCount(0);
    await expect(staff.getByRole('link', { name: 'Estimations fiscales' })).toHaveCount(0);
    for (const path of ['/reports', `/tax/reports/${reportId}`, `/properties/${propertyId}/tax`]) {
      await staff.goto(path);
      await expect(staff).toHaveURL(/\/dashboard$/);
    }
    for (const path of ['/api/tax/reports', `/api/tax/reports/${reportId}`, '/api/tax/rules', `/api/properties/${propertyId}/tax-reports`]) {
      expect((await staffApi.get(path)).status(), path).toBe(403);
    }
  });
});
