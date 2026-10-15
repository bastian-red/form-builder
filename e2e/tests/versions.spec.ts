/**
 * docs/SPECS.md outcome 2: editing a form never changes what an old response
 * meant. Publish v1, answer it, reword a question, publish v2: version 1's
 * report keeps the old wording, version 2's has the new.
 */
import type { Page } from '@playwright/test';

import { expect, openBuilder, questionBox, signUpFresh, test } from '../fixtures';

async function answerOnce(page: Page, slug: string) {
  await page.goto(`/f/${slug}`);
  await expect(page.locator('.respond-page[data-ready]')).toBeVisible();
  await page.keyboard.press('y');
  await page.getByRole('button', { name: /Submit/u }).click();
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
}

test('a reworded question does not rewrite version 1', async ({ page, browser }) => {
  await signUpFresh(page, 'versions');
  await openBuilder(page, 'Version check');
  await page.getByRole('button', { name: /Add a question/u }).click();
  await page.getByRole('dialog').getByRole('combobox').fill('yes');
  await page.keyboard.press('Enter');
  await questionBox(page).fill('Is the old wording clear?');
  await expect(page.locator('.builder-save')).toHaveText(/Saved/u, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
  const slug = /\/f\/([a-z0-9-]+)/u.exec(
    (await page.getByRole('link', { name: /Open form/u }).getAttribute('href')) ?? '',
  )?.[1];
  expect(slug).toBeDefined();

  const respondent = await browser.newPage();
  await answerOnce(respondent, slug!);

  await page
    .locator('.block-title')
    .getByText('Is the old wording clear?', { exact: true })
    .click();
  await questionBox(page).fill('Is the new wording clearer?');
  await expect(page.locator('.builder-save')).toHaveText(/Saved/u, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published version 2.')).toBeVisible();
  await answerOnce(respondent, slug!);

  await page.getByRole('link', { name: 'Results' }).click();
  await expect(page.getByRole('heading', { name: 'Is the new wording clearer?' })).toBeVisible();
  await page.getByLabel('Version').selectOption({ label: 'Version 1 (1 completed)' });
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('heading', { name: 'Is the old wording clear?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Is the new wording clearer?' })).toHaveCount(0);
});

test('closing a form shows respondents a closed page', async ({ page, browser }) => {
  await signUpFresh(page, 'closer');
  await openBuilder(page, 'Closing soon');
  await page.getByRole('button', { name: /Add a question/u }).click();
  await page.getByRole('dialog').getByRole('combobox').fill('yes');
  await page.keyboard.press('Enter');
  await expect(page.locator('.builder-save')).toHaveText(/Saved/u, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
  const href = (await page.getByRole('link', { name: /Open form/u }).getAttribute('href')) ?? '';

  await page.getByRole('link', { name: 'Results' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Close form' }).click();
  await expect(page.getByText('Closed to responses')).toBeVisible();

  const respondent = await browser.newPage();
  await respondent.goto(href);
  await expect(respondent.getByRole('heading', { name: 'This form is closed' })).toBeVisible();
});
