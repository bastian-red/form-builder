/**
 * The respondent, on the seeded form: one question a screen, keycaps, Enter,
 * the branch taken and not taken, Back changing the branch, and the answer
 * arriving in the results.
 */
import type { Page } from '@playwright/test';

import {
  DEMO_FIRST_QUESTION,
  DEMO_FORM_SLUG,
  completedCount,
  demoFormId,
  expect,
  signIn,
  test,
} from '../fixtures';

// Errors by class, not role: Next's route announcer is also role="alert".
const question = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 1, name });

async function start(page: Page) {
  await page.goto(`/f/${DEMO_FORM_SLUG}`);
  await expect(page.locator('.respond-page[data-ready]')).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(question(page, /Two minutes, ten questions/u)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(question(page, DEMO_FIRST_QUESTION)).toBeVisible();
}

test('a manager answers by keyboard, takes the detractor branch, and is counted', async ({
  page,
  browser,
}) => {
  const author = await browser.newPage();
  await signIn(author);
  const formId = await demoFormId(author);
  const before = await completedCount(author, formId);

  await start(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('.respond-error')).toHaveText(/Choose an answer to continue/u);

  await page.keyboard.press('c'); // Manager
  await page.keyboard.press('Enter');
  await expect(question(page, 'How many people are on your team?')).toBeVisible();
  await page.getByRole('textbox').fill('300');
  await page.keyboard.press('Enter');
  await expect(page.locator('.respond-error')).toHaveText(/at most 200/u);
  await page.getByRole('textbox').fill('12');
  await page.keyboard.press('Enter');

  await expect(question(page, /How often do you create or edit a form/u)).toBeVisible();
  await page.keyboard.press('b');
  await page.keyboard.press('Enter');
  await expect(question(page, 'When did you start using us?')).toBeVisible();
  await page.keyboard.press('Enter'); // optional, skipped
  await expect(question(page, 'Which features do you rely on?')).toBeVisible();
  await page.keyboard.press('a');
  await page.keyboard.press('c');
  await page.keyboard.press('Enter');
  await expect(question(page, 'How easy was your first form to build?')).toBeVisible();
  // The radio is visually hidden under its label; a person clicks the label.
  await page.locator('.respond-scale-step').filter({ hasText: /^4$/u }).click();
  await page.keyboard.press('Enter');
  await expect(question(page, /How likely are you to recommend us/u)).toBeVisible();
  await page.locator('.respond-scale-step').filter({ hasText: /^3$/u }).click();
  await page.keyboard.press('Enter');

  // A score below 7 jumps past "What do you love most?".
  await expect(question(page, 'What should we improve first?')).toBeVisible();
  await page.getByRole('textbox').fill('Templates, please.');
  await page.keyboard.press('Enter');
  await expect(question(page, /May we follow up/u)).toBeVisible();
  await page.keyboard.press('n');
  await page.getByRole('button', { name: /Submit/u }).click();
  await expect(question(page, 'Thank you')).toBeVisible();

  expect(await completedCount(author, formId)).toBe(before + 1);
});

test('going back and changing the answer changes the branch', async ({ page }) => {
  await start(page);
  await page.keyboard.press('a'); // Engineer
  await page.keyboard.press('Enter');
  await expect(question(page, /How often do you create or edit a form/u)).toBeVisible();

  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(question(page, DEMO_FIRST_QUESTION)).toBeVisible();
  await page.keyboard.press('c'); // Manager
  await page.keyboard.press('Enter');
  await expect(question(page, 'How many people are on your team?')).toBeVisible();
  await expect(page.locator('.respond-count')).toHaveText(/3 of/u);
});

test('the progress bar and the count move together', async ({ page }) => {
  await start(page);
  await expect(page.locator('.respond-count')).toHaveText(/2 of 1\d/u);
  const share = await page.getByRole('progressbar').getAttribute('aria-valuenow');
  expect(Number(share)).toBeGreaterThan(0);
});
