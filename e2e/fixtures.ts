/**
 * Shared E2E helpers.
 *
 * The seeded facts are read out of `packages/db/prisma/seed.mts` rather than
 * retyped, so a renamed seed form fails here with a sentence instead of every
 * spec failing with "element not found".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test as base, type Page } from '@playwright/test';

const SEED = readFileSync(join(__dirname, '..', 'packages', 'db', 'prisma', 'seed.mts'), 'utf8');

function seedConst(name: string): string {
  const match = new RegExp(`^const ${name} = '([^']*)';`, 'm').exec(SEED);
  if (!match) throw new Error(`Could not read ${name} out of packages/db/prisma/seed.mts.`);
  return match[1]!;
}

export const DEMO_EMAIL = seedConst('DEMO_EMAIL');
export const DEMO_PASSWORD = seedConst('DEMO_PASSWORD');
export const DEMO_FORM_TITLE = seedConst('DEMO_FORM_TITLE');
export const DEMO_FORM_SLUG = seedConst('DEMO_FORM_SLUG');
export const DEMO_FIRST_QUESTION = seedConst('DEMO_FIRST_QUESTION');
export const DRAFT_FORM_TITLE = seedConst('DRAFT_FORM_TITLE');

export const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';

export async function signIn(
  page: Page,
  email = DEMO_EMAIL,
  password = DEMO_PASSWORD,
  next?: string,
) {
  await page.goto(next === undefined ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'));
}

/** A new account, so a spec that creates forms never shares a list with another. */
export async function signUpFresh(page: Page, label: string): Promise<string> {
  const email = `${label}-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}@forms.test`;
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill(label);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  return email;
}

/** The seeded form's id, read from its builder link in the list. */
export async function demoFormId(page: Page): Promise<string> {
  await page.goto('/');
  const href = await page
    .getByRole('link', { name: DEMO_FORM_TITLE, exact: true })
    .first()
    .getAttribute('href');
  const id = /\/forms\/([a-z0-9]+)\/edit/u.exec(href ?? '')?.[1];
  if (id === undefined) throw new Error(`no builder link for ${DEMO_FORM_TITLE}`);
  return id;
}

/** Completed responses for the seeded form's latest version, read from the API's health-free public surface: the results page. */
export async function completedCount(page: Page, formId: string): Promise<number> {
  await page.goto(`/forms/${formId}/results`);
  const text = await page
    .locator('.kpi')
    .filter({ hasText: 'Completed' })
    .locator('dd')
    .innerText();
  return Number(text.replace(/,/gu, ''));
}

/** The inspector's question text. By role: getByLabel would fold the textarea's own text into the label. */
export const questionBox = (page: Page) =>
  page.getByRole('textbox', { name: 'Question', exact: true });

export async function openBuilder(page: Page, title: string) {
  await page.getByLabel('New form').fill(title);
  await page.getByRole('button', { name: 'Create and open' }).click();
  await expect(page.locator('.builder[data-ready]')).toBeVisible();
}

/**
 * Every spec fails on an uncaught error in the page.
 *
 * Without it a client component can throw on every render, leave a blank region
 * behind, and the spec still passes because the element it asserts on was
 * rendered by the server. Auto-applied, so no spec can forget it.
 */
export const test = base.extend<{ failOnPageError: void }>({
  failOnPageError: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use();
      expect(errors, 'uncaught errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
