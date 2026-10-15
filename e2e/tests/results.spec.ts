/**
 * The report on the seeded form: numbers that agree with each other, a filter
 * that scopes everything, the response table, and the CSV.
 */
import { readFileSync } from 'node:fs';

import {
  DEMO_FIRST_QUESTION,
  DEMO_FORM_TITLE,
  demoFormId,
  expect,
  signIn,
  test,
} from '../fixtures';

test('the KPI row, the funnel and the first card agree', async ({ page }) => {
  await signIn(page);
  const id = await demoFormId(page);
  await page.goto(`/forms/${id}/results`);
  const completed = Number(
    (await page.locator('.kpi').filter({ hasText: 'Completed' }).locator('dd').innerText()).replace(
      /,/gu,
      '',
    ),
  );
  expect(completed).toBeGreaterThan(200);

  // Every completed response answered the required first question.
  const card = page.getByRole('region', { name: DEMO_FIRST_QUESTION });
  await expect(card.locator('.report-card-meta')).toContainText(
    `${completed.toLocaleString('en-US')} answered`,
  );
  // The table alternative holds the same numbers as the bars.
  await card.getByText('Show as a table').click();
  const cells = await card.locator('tbody td:nth-child(2)').allInnerTexts();
  expect(cells.map(Number).reduce((a, b) => a + b, 0)).toBe(completed);
});

test('filtering by an answer scopes every number below it', async ({ page }) => {
  await signIn(page);
  const id = await demoFormId(page);
  await page.goto(`/forms/${id}/results`);
  await page.getByLabel('Only respondents who answered').selectOption({ label: 'Manager' });
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/filter=/u);
  await expect(
    page.getByText('Showing only respondents who gave the chosen answer.'),
  ).toBeVisible();

  const card = page.getByRole('region', { name: DEMO_FIRST_QUESTION });
  await card.getByText('Show as a table').click();
  const rows = await card.locator('tbody tr').allInnerTexts();
  const nonZero = rows.filter((row) => !/\t0\t/u.test(`${row}\t`));
  expect(nonZero).toHaveLength(1);
  expect(nonZero[0]).toContain('Manager');
});

test("the response table pages, and the CSV carries that version's columns", async ({ page }) => {
  await signIn(page);
  const id = await demoFormId(page);
  await page.goto(`/forms/${id}/results?tab=responses`);
  await expect(page.getByRole('columnheader', { name: DEMO_FIRST_QUESTION })).toBeVisible();
  const firstPage = await page.locator('.responses-table tbody tr').count();
  expect(firstPage).toBe(50);
  await page.getByRole('link', { name: 'Next page' }).click();
  await expect(page.locator('.responses-table tbody tr').first()).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: /Download CSV/u }).click();
  const file = await (await download).path();
  const csv = readFileSync(file!, 'utf8').replace(/^\uFEFF/u, '');
  const [header, ...lines] = csv.trimEnd().split('\r\n');
  expect(header).toContain('What best describes your role?');
  expect(header).toContain('When did you start using us?');
  expect(lines.length).toBeGreaterThan(200);
  expect((await download).suggestedFilename()).toMatch(/^product-feedback-survey-v\d+\.csv$/u);
  void DEMO_FORM_TITLE;
});
