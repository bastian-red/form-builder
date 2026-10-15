/**
 * axe over every route, in both colour schemes, zero violations.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

import { DEMO_FORM_SLUG, demoFormId, expect, signIn, test } from '../fixtures';

const SCHEMES = ['light', 'dark'] as const;
const RECORDING = process.env.BASELINE === '1';

async function scan(page: Page, testInfo: TestInfo, route: string, scheme: string) {
  // Measure the resting state, not a transition: the respondent screen rises in
  // over 380ms, and axe sampling it mid-fade reports contrast at partial opacity.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  if (RECORDING) {
    await testInfo.attach('a11y', {
      contentType: 'application/json',
      body: JSON.stringify({ route, scheme, violations: results.violations }),
    });
    return;
  }
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    })),
  ).toEqual([]);
}

for (const scheme of SCHEMES) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });

    test('sign in', async ({ page }, testInfo) => {
      await page.goto('/sign-in');
      await scan(page, testInfo, '/sign-in', scheme);
    });

    test('sign up', async ({ page }, testInfo) => {
      await page.goto('/sign-up');
      await scan(page, testInfo, '/sign-up', scheme);
    });

    test('status', async ({ page }, testInfo) => {
      await page.goto('/status');
      await scan(page, testInfo, '/status', scheme);
    });

    test('form list', async ({ page }, testInfo) => {
      await signIn(page);
      await scan(page, testInfo, '/', scheme);
    });

    test('builder, with an issue on a block', async ({ page }, testInfo) => {
      await signIn(page);
      const id = await demoFormId(page);
      await page.goto(`/forms/${id}/edit`);
      await expect(page.locator('.builder[data-ready]')).toBeVisible();
      await expect(page.locator('.gutter-edge').first()).toBeVisible();
      await scan(page, testInfo, '/forms/:id/edit', scheme);
    });

    test('builder, insert palette open', async ({ page }, testInfo) => {
      await signIn(page);
      const id = await demoFormId(page);
      await page.goto(`/forms/${id}/edit`);
      await expect(page.locator('.builder[data-ready]')).toBeVisible();
      await page.getByRole('button', { name: /Add a question/u }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await scan(page, testInfo, 'palette', scheme);
    });

    test('builder, preview', async ({ page }, testInfo) => {
      await signIn(page);
      const id = await demoFormId(page);
      await page.goto(`/forms/${id}/edit`);
      await expect(page.locator('.builder[data-ready]')).toBeVisible();
      await page.getByRole('button', { name: 'Preview' }).click();
      await expect(page.getByRole('region', { name: 'Preview of the form' })).toBeVisible();
      await scan(page, testInfo, 'preview', scheme);
    });

    test('results report', async ({ page }, testInfo) => {
      await signIn(page);
      const id = await demoFormId(page);
      await page.goto(`/forms/${id}/results`);
      await scan(page, testInfo, '/forms/:id/results', scheme);
    });

    test('results, responses table', async ({ page }, testInfo) => {
      await signIn(page);
      const id = await demoFormId(page);
      await page.goto(`/forms/${id}/results?tab=responses`);
      await scan(page, testInfo, '/forms/:id/results?tab=responses', scheme);
    });

    test('public form: intro, a choice question with an error, the ending', async ({
      page,
    }, testInfo) => {
      await page.goto(`/f/${DEMO_FORM_SLUG}`);
      await expect(page.locator('.respond-page[data-ready]')).toBeVisible();
      await scan(page, testInfo, '/f/:slug intro', scheme);
      await page.getByRole('button', { name: 'Start' }).click();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await expect(page.locator('.respond-error')).toBeVisible();
      await scan(page, testInfo, '/f/:slug question with error', scheme);
    });

    test('not found', async ({ page }, testInfo) => {
      await page.goto('/f/no-such-form');
      await expect(page.getByRole('heading', { name: 'Nothing at this address' })).toBeVisible();
      await scan(page, testInfo, '404', scheme);
    });
  });
}
