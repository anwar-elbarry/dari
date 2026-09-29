import { expect, test } from '@playwright/test';
import { lastLink } from './mail';

/** Phase 1 definition of done, on a phone: sign up → add owner + property → invite staff → staff sees the reduced view. */
test('manager onboarding and staff invitation', async ({ page, browser }) => {
  const run = Date.now();
  const managerEmail = `manager-${run}@e2e.test`;
  const staffEmail = `staff-${run}@e2e.test`;
  const password = 'e2e-password-123';

  await test.step('sign up (French by default)', async () => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: 'Créer votre compte' })).toBeVisible();
    await page.getByLabel('Nom de la société ou conciergerie').fill('Conciergerie Atlas');
    await page.getByLabel('Votre nom').fill('Samir');
    await page.getByLabel('E-mail professionnel').fill(managerEmail);
    await page.getByLabel('Mot de passe').fill(password);
    await page.getByRole('button', { name: 'Créer le compte' }).click();
    await expect(page).toHaveURL(/\/properties\/new$/);
  });

  await test.step('add a property with a new owner through the 3-step wizard', async () => {
    await page.getByLabel('Nom du bien').fill('Riad Yasmine');
    await page.getByLabel('Adresse').fill('12 Derb Sidi Bouloukat, Médina');
    await page.getByRole('button', { name: 'Suivant' }).click();

    await page.getByLabel("Statut d'autorisation").selectOption('UNLICENSED');
    await page.getByLabel("Type d'hébergement").selectOption('RIAD');
    await page.getByLabel('Régime fiscal').selectOption('PROPERTY_INCOME');
    await page.getByLabel('Taxe de séjour').selectOption('COLLECTED');
    await page.getByRole('button', { name: 'Suivant' }).click();

    await page.getByLabel('Nom complet').fill('Karim Benali');
    await page.getByLabel('Résidence fiscale').selectOption('MRE');
    await page.getByRole('button', { name: 'Créer le bien' }).click();

    await expect(page).toHaveURL(/\/properties$/);
    await expect(page.getByRole('heading', { name: 'Riad Yasmine' })).toBeVisible();
    await expect(page.getByText('Karim Benali')).toBeVisible();
    await expect(page.getByText('Sans autorisation')).toBeVisible();
  });

  await test.step('invite a staff member', async () => {
    await page.getByRole('link', { name: 'Équipe' }).click();
    await page.getByLabel('E-mail').fill(staffEmail);
    await page.getByRole('button', { name: "Envoyer l'invitation" }).click();
    await expect(page.getByText(`Invitation envoyée à ${staffEmail}.`)).toBeVisible();
    await expect(page.getByText(staffEmail, { exact: true })).toBeVisible();
  });

  await test.step('staff accepts and only sees the reduced property view', async () => {
    const link = await lastLink(staffEmail);
    const staff = await browser.newContext({ ...test.info().project.use });
    const sp = await staff.newPage();
    await sp.goto(link);
    await expect(sp.getByText('Conciergerie Atlas vous invite en tant que Équipe (check-in, ménage).')).toBeVisible();
    expect(sp.url()).not.toContain('token=');
    expect(link).toContain('#token=');

    await sp.getByLabel('Votre nom').fill('Hind');
    await sp.getByLabel('Choisissez un mot de passe').fill(password);
    await sp.getByRole('button', { name: "Accepter l'invitation" }).click();

    await expect(sp).toHaveURL(/\/properties$/);
    await expect(sp.getByRole('heading', { name: 'Riad Yasmine' })).toBeVisible();
    await expect(sp.getByText('Karim Benali')).toHaveCount(0);
    await expect(sp.getByRole('link', { name: 'Ajouter un bien' })).toHaveCount(0);
    await expect(sp.getByRole('link', { name: 'Équipe' })).toHaveCount(0);

    await sp.goto('/team');
    await expect(sp).toHaveURL(/\/properties$/);
    await staff.close();
  });

  await test.step('log out, then the signed-in area sends back to login', async () => {
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/properties');
    await expect(page).toHaveURL(/\/login\?next=%2Fproperties$/);
  });

  await test.step('log in again and land on the requested page', async () => {
    await page.getByLabel('E-mail').fill(managerEmail);
    await page.getByLabel('Mot de passe').fill(password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/properties$/);
  });
});

test('login ignores off-site ?next= targets', async ({ page }) => {
  const email = `next-${Date.now()}@e2e.test`;
  await page.goto('/signup');
  await page.getByLabel('Nom de la société ou conciergerie').fill('Next Co');
  await page.getByLabel('Votre nom').fill('Nora');
  await page.getByLabel('E-mail professionnel').fill(email);
  await page.getByLabel('Mot de passe').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page).toHaveURL(/\/properties\/new$/);
  await page.getByRole('button', { name: 'Se déconnecter' }).click();

  await page.goto('/login?next=%2F%09%2Fevil.example');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Mot de passe').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\/properties/);
});

test('language switch and generic login error', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'en', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  await page.getByLabel('Email').fill('nobody@e2e.test');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Wrong' })).toHaveText('Wrong email or password.');

  await page.getByRole('button', { name: 'fr', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
});
