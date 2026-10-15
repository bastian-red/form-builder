/**
 * The builder: insert by palette, logic by menus, a jump drawn in the gutter,
 * a keyboard reorder that breaks it, the analyzer saying so, and publishing.
 */
import type { Page } from '@playwright/test';

import { expect, openBuilder, questionBox, signUpFresh, test } from '../fixtures';

async function addQuestion(page: Page, type: string, title: string) {
  await expect(page.locator('.builder[data-ready]')).toBeVisible();
  // Away from any text box, so "/" reaches the palette shortcut.
  await page.locator('.builder-status').click();
  await page.keyboard.press('/');
  const palette = page.getByRole('dialog');
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox', { name: 'Question type' }).fill(type);
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await questionBox(page).fill(title);
}

/**
 * Sort a block with the keyboard, the way a screen-reader user does, waiting on
 * dnd-kit's live announcements between keys rather than on time. Each wait is
 * also an assertion that the announcement says something a person can use.
 */
async function keyboardMove(page: Page, from: number, key: 'ArrowUp' | 'ArrowDown', to: number) {
  await page
    .getByRole('button', { name: new RegExp(`Move question ${String(from)},`, 'u') })
    .focus();
  await page.keyboard.press('Space');
  // The live region keeps only the latest message, so "Picked up" is replaced
  // at once by "is over position N"; the drag state is the stable signal.
  await expect(page.locator('.block[data-dragging]')).toHaveCount(1);
  const step = key === 'ArrowUp' ? -1 : 1;
  for (let at = from + step; at !== to + step; at += step) {
    await page.keyboard.press(key);
    await expect(
      page.getByText(new RegExp(`is over position ${String(at)} of`, 'u')),
    ).toBeAttached();
  }
  await page.keyboard.press('Space');
  await expect(
    page.getByText(new RegExp(`Moved .* to position ${String(to)} of`, 'u')),
  ).toBeAttached();
}

async function waitSaved(page: Page) {
  await expect(page.locator('.builder-save')).toHaveText(/Saved/u, { timeout: 15_000 });
}

test('build a branching form, break it with a keyboard move, fix it, publish it', async ({
  page,
}) => {
  await signUpFresh(page, 'builder');
  await openBuilder(page, 'Onboarding check-in');
  await expect(page.getByText('An empty sheet.')).toBeVisible();

  await addQuestion(page, 'single', 'Which team are you joining?');
  await page.getByRole('textbox', { name: 'Option 1', exact: true }).fill('Engineering');
  await page.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Sales');
  await addQuestion(page, 'number', 'How many years of experience?');
  await addQuestion(page, 'yes', 'Did your laptop arrive?');

  // Question 2 only for Engineering.
  await page
    .locator('.block-title')
    .getByText('How many years of experience?', { exact: true })
    .click();
  await page.getByLabel('Only when…').check();
  await page.getByLabel('Visibility rule 1: comparison').selectOption({ label: 'is' });
  await page.getByLabel('Visibility rule 1: option').selectOption({ label: 'Engineering' });
  await expect(page.locator('.block-logic').first()).toHaveText(
    /Shown if “Which team are you joining\?” is “Engineering”/u,
  );

  // A jump on question 1: Sales skips straight to question 3.
  await page
    .locator('.block-title')
    .getByText('Which team are you joining?', { exact: true })
    .click();
  await page.getByRole('button', { name: 'Add a jump' }).click();
  await page.getByLabel('Jump 1 rule: comparison').selectOption({ label: 'is' });
  await page.getByLabel('Jump 1 rule: option').selectOption({ label: 'Sales' });
  await page.getByLabel('go to').selectOption({ label: '3. Did your laptop arrive?' });
  await expect(page.locator('.gutter-edge')).toHaveCount(1);
  await expect(page.locator('.gutter-edge[data-broken]')).toHaveCount(0);
  await waitSaved(page);

  // Move question 3 to the top with the keyboard: the jump now points backwards.
  await keyboardMove(page, 3, 'ArrowUp', 1);
  await expect(page.locator('.block').first()).toContainText('Did your laptop arrive?');
  await expect(page.locator('.gutter-edge[data-broken]')).toHaveCount(1);
  await expect(page.locator('.block-issue').first()).toContainText('Jumps can only go forward');
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();
  await expect(page.locator('#publish-why')).toHaveText(/1 problem to fix/u);

  // Move it back to the bottom.
  await keyboardMove(page, 1, 'ArrowDown', 3);
  await expect(page.locator('.gutter-edge[data-broken]')).toHaveCount(0);
  await waitSaved(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();

  // Autosave is real: a reload shows the saved draft, logic included.
  await page.reload();
  await expect(page.locator('.block')).toHaveCount(3);
  await expect(page.locator('.block-logic')).toHaveCount(2);
  await expect(page.getByText('Version 1 live')).toBeVisible();
});

test('a second tab saving first is reported, never overwritten', async ({ page, context }) => {
  await signUpFresh(page, 'twotabs');
  await openBuilder(page, 'Shared draft');
  await addQuestion(page, 'short', 'First tab question');
  await waitSaved(page);

  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.locator('.builder[data-ready]')).toBeVisible();
  await other.locator('.builder-title').fill('Renamed in tab two');
  await expect(other.locator('.builder-save')).toHaveText(/Saved/u, { timeout: 15_000 });

  await page.locator('.builder-title').fill('Renamed in tab one');
  await expect(page.getByText('Saved from another tab')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Reload the latest version' })).toBeVisible();
});

test('the preview runs the real respondent renderer and follows the logic', async ({ page }) => {
  await signUpFresh(page, 'preview');
  await openBuilder(page, 'Preview me');
  await addQuestion(page, 'yes', 'Do you drink coffee?');
  await addQuestion(page, 'short', 'Favourite roast?');
  await page.getByLabel('Only when…').check();
  await page.getByLabel('Visibility rule 1: comparison').selectOption({ label: 'is' });

  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByRole('region', { name: 'Preview of the form' });
  await expect(preview.getByRole('heading', { name: 'Do you drink coffee?' })).toBeVisible();
  await preview.getByText('No', { exact: true }).click();
  await preview.getByRole('button', { name: /Submit/u }).click();
  await expect(preview.getByRole('heading', { name: 'Thank you' })).toBeVisible();
});
