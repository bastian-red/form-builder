/**
 * The README's demo, captured as frames by `scripts/demo-gif.sh` (DEMO=1 only;
 * playwright.config.ts ignores this file otherwise).
 *
 * The story in nine frames: the author's ledger, the builder's logic gutter, a
 * question's logic in the inspector, the respondent's welcome, a choice with its
 * keycap, the manager-only branch opening, the thank-you, the report's KPIs and
 * funnel, and the NPS card. Each frame is one viewport at a fixed size, so the
 * GIF does not jump.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { DEMO_FORM_SLUG, demoFormId, expect, signIn, test } from '../fixtures';

const SHOTS = join(__dirname, '..', 'demo-shots');

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });

async function frame(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test('demo', async ({ page, browser }) => {
  await signIn(page);
  await frame(page, '01-forms');

  const id = await demoFormId(page);
  await page.goto(`/forms/${id}/edit`);
  await expect(page.locator('.builder[data-ready]')).toBeVisible();
  await page
    .locator('.block-title')
    .getByText('How likely are you to recommend us to a colleague?')
    .scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 380);
  await frame(page, '02-builder-gutter');

  await page
    .locator('.block-title')
    .getByText('How many people are on your team?', { exact: true })
    .click();
  await page.mouse.wheel(0, -400);
  await page.locator('.builder-side').evaluate((side) => side.scrollTo(0, 260));
  await frame(page, '03-builder-logic');

  const respondent = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await respondent.goto(`/f/${DEMO_FORM_SLUG}`);
  await expect(respondent.locator('.respond-page[data-ready]')).toBeVisible();
  await frame(respondent, '04-respond-welcome');
  await respondent.getByRole('button', { name: 'Start' }).click();
  await respondent.keyboard.press('Enter');
  await respondent.keyboard.press('c');
  await frame(respondent, '05-respond-choice');
  await respondent.keyboard.press('Enter');
  await expect(
    respondent.getByRole('heading', { name: 'How many people are on your team?' }),
  ).toBeVisible();
  await respondent.getByRole('textbox').fill('8');
  await frame(respondent, '06-respond-branch');

  await page.goto(`/forms/${id}/results`);
  await frame(page, '07-results');
  await page
    .getByRole('heading', { name: /How likely are you to recommend us/u })
    .scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 200);
  await frame(page, '08-results-nps');
});
