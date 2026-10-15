import { DEMO_EMAIL, DEMO_FORM_TITLE, expect, signIn, signUpFresh, test } from '../fixtures';

test('a signed-out visitor is sent to sign in and back to where they were going', async ({
  page,
}) => {
  await page.goto('/status');
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in\?next=%2F/u);
  await signIn(page);
  await expect(page.getByRole('link', { name: DEMO_FORM_TITLE, exact: true })).toBeVisible();
});

test('a wrong password and an unknown account get the same sentence', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(DEMO_EMAIL);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const wrong = await page.locator('.form-error').innerText();
  await page.getByLabel('Email').fill('nobody@forms.test');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.form-error')).toHaveText(wrong);
});

test('signing up lands on an empty list that offers to create a form', async ({ page }) => {
  await signUpFresh(page, 'newcomer');
  await expect(page.getByRole('heading', { name: 'Your forms' })).toBeVisible();
  await expect(page.getByText('No forms yet.')).toBeVisible();
});
