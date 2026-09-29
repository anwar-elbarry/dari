import http from 'node:http';
import { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';

/** Phase 2 definition of done, on a phone: calendar link → sync → review → counter, CSV import, dashboard. */
const year = new Date().getUTCFullYear();
const ics = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//E2E//EN',
  'BEGIN:VEVENT', 'UID:e2e-stay@airbnb.com', `DTSTART;VALUE=DATE:${year}0301`, `DTEND;VALUE=DATE:${year}0305`, 'SUMMARY:Reserved', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:e2e-odd@airbnb.com', `DTSTART;VALUE=DATE:${year}0610`, `DTEND;VALUE=DATE:${year}0613`, 'SUMMARY:Something else', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

let server: http.Server;
let calendarUrl: string;

test.beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/calendar' });
    res.end(ics);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  calendarUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cal.ics`;
});
test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

test('calendar sync, review, CSV import and dashboard', async ({ page }) => {
  const meter = () => page.getByRole('meter');

  await test.step('sign up and create an unlicensed property', async () => {
    await page.goto('/signup');
    await page.getByLabel('Nom de la société ou conciergerie').fill('Conciergerie Souk');
    await page.getByLabel('Votre nom').fill('Nadia');
    await page.getByLabel('E-mail professionnel').fill(`p2-${Date.now()}@e2e.test`);
    await page.getByLabel('Mot de passe').fill('e2e-password-123');
    await page.getByRole('button', { name: 'Créer le compte' }).click();
    await page.getByLabel('Nom du bien').fill('Riad Souk');
    await page.getByLabel('Adresse').fill('3 Derb Dabachi, Médina');
    await page.getByRole('button', { name: 'Suivant' }).click();
    await page.getByLabel("Statut d'autorisation").selectOption('UNLICENSED');
    await page.getByLabel("Type d'hébergement").selectOption('RIAD');
    await page.getByLabel('Régime fiscal').selectOption('PROPERTY_INCOME');
    await page.getByLabel('Taxe de séjour').selectOption('COLLECTED');
    await page.getByRole('button', { name: 'Suivant' }).click();
    await page.getByLabel('Nom complet').fill('Omar Alami');
    await page.getByRole('button', { name: 'Créer le bien' }).click();
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/);
    await expect(meter()).toHaveAttribute('aria-valuenow', '0');
  });

  await test.step('add the calendar link: it syncs at once', async () => {
    await page.getByLabel('Lien iCal').fill(calendarUrl);
    await page.getByRole('button', { name: 'Ajouter le calendrier' }).click();
    await expect(page.getByText('2 créés, 0 mis à jour, 0 annulés.')).toBeVisible();
    await expect(page.getByText('À jour', { exact: true })).toBeVisible();
    await expect(meter()).toHaveAttribute('aria-valuenow', '4'); // 4 nights of the stay; the unknown event waits
  });

  await test.step('the uncertain event is not counted until confirmed', async () => {
    await expect(page.getByRole('heading', { name: 'Événements à confirmer' })).toBeVisible();
    await page.getByRole('button', { name: "C'est un séjour" }).click();
    await expect(page.getByText('Décision enregistrée.')).toBeVisible();
    await expect(meter()).toHaveAttribute('aria-valuenow', '7');
    await expect(page.getByRole('heading', { name: 'Événements à confirmer' })).toHaveCount(0);
  });

  await test.step('import earlier stays from a CSV (names in the file are ignored)', async () => {
    await page.getByRole('link', { name: 'Importer des séjours' }).click();
    const csv = `check_in,check_out,platform,confirmation_code,Guest name\n${year}-08-01,${year}-08-03,DIRECT,E2E-1,Jean Dupont\n`;
    await page.getByLabel('Fichier CSV').setInputFiles({ name: 'stays.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByRole('button', { name: 'Vérifier le fichier' }).click();
    await expect(page.getByText('1 ligne valide sur 1. 0 déjà importées.')).toBeVisible();
    await page.getByRole('button', { name: 'Importer 1 séjour' }).click();
    await expect(page.getByText('1 séjour importé, 0 déjà présents, 0 lignes ignorées.')).toBeVisible();

    // Importing the same file again adds nothing.
    await page.getByLabel('Fichier CSV').setInputFiles({ name: 'stays.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByRole('button', { name: 'Vérifier le fichier' }).click();
    await expect(page.getByText('1 ligne valide sur 1. 1 déjà importées.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Importer 0 séjour' })).toBeDisabled();
  });

  await test.step('the dashboard shows the updated counter', async () => {
    await page.getByRole('link', { name: 'Tableau de bord' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Riad Souk' })).toBeVisible();
    await expect(page.getByRole('meter')).toHaveAttribute('aria-valuenow', '9');
    await expect(page.getByText('Sous le seuil')).toBeVisible();
    await expect(page.getByText('Dupont')).toHaveCount(0);
  });
});
