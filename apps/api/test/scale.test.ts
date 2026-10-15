/**
 * docs/SPECS.md outcome 4: results over 100,000 completed responses.
 *
 * Two paths, two budgets:
 *
 * - **Unfiltered** reads the counters, so its cost does not grow with the
 *   response count. Budget: p95 under 150 ms, the spec's number.
 * - **Filtered** cannot use counters and scans the rows the GIN index selects.
 *   Its budget is pinned with headroom above what the build machine measured,
 *   and its cache is cleared before every sample so each one is a real scan.
 *
 * The rows are generated inside Postgres (generate_series with a fixed
 * `setseed`), then the counters are rebuilt with the same `recount` the seed
 * uses. Measured numbers are printed, so a regression shows up as a number in
 * the CI log before it fails.
 */
import { randomUUID } from 'node:crypto';

import type { SessionUser } from '@forms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BRANCHING,
  boot,
  call,
  newAuthor,
  publishedForm,
  recountNow,
  type Harness,
} from './support';

const ROWS = 100_000;
const SAMPLES = 15;
const UNFILTERED_P95_BUDGET_MS = 150;
const FILTERED_P95_BUDGET_MS = 1500;

let harness: Harness;
let owner: SessionUser;
let form: { id: string; versionId: string };

beforeAll(async () => {
  harness = await boot();
  owner = await newAuthor(harness.db, 'scale');
  form = await publishedForm(harness, owner, {
    ...BRANCHING,
    title: `Scale ${randomUUID().slice(0, 6)}`,
  });
  await harness.db.$executeRaw`SELECT setseed(0.42)`;
  await harness.db.$executeRaw`
    INSERT INTO responses (id, form_id, form_version_id, answers, reached, started_at, updated_at, submitted_at)
    SELECT gen_random_uuid(), ${form.id}, ${form.versionId},
           CASE WHEN random() < 0.3
             THEN jsonb_build_object('f_role0001', 'o_manager1', 'f_team0001', 1 + floor(random() * 99)::int,
                                     'f_score001', floor(random() * 11)::int, 'f_note0001', 'note ' || n)
             ELSE jsonb_build_object('f_role0001', 'o_student1', 'f_score001', floor(random() * 11)::int)
           END,
           ARRAY['f_role0001', 'f_score001'],
           -- One response a minute, so submission times are distinct the way
           -- real ones are; the "latest ten" query walks the index by them.
           now() - n * interval '1 minute', now() - n * interval '1 minute' + interval '90 seconds',
           now() - n * interval '1 minute' + interval '90 seconds'
      FROM generate_series(1, ${ROWS}) AS n`;
  await harness.db.$executeRawUnsafe('ANALYZE responses');
  await recountNow(harness.db, form.versionId, { ...BRANCHING, title: 'Scale' });
}, 300_000);

async function timed(
  path: string,
  clear: boolean,
): Promise<{ timings: number[]; body: { totals: { completed: number }; cached: boolean } }> {
  const timings: number[] = [];
  let body = { totals: { completed: 0 }, cached: false };
  for (let i = 0; i < SAMPLES; i += 1) {
    if (clear) {
      const keys = await harness.redis.keys(`results:v1:${form.versionId}:*`);
      if (keys.length > 0) await harness.redis.del(...keys);
    }
    const started = performance.now();
    const reply = await call<typeof body>(harness, 'GET', path, { user: owner });
    timings.push(performance.now() - started);
    expect(reply.status).toBe(200);
    body = reply.body;
  }
  return { timings: timings.sort((a, b) => a - b), body };
}

const p95 = (sorted: number[]) => sorted[Math.ceil(sorted.length * 0.95) - 1]!;
const p50 = (sorted: number[]) => sorted[Math.floor(sorted.length * 0.5)]!;

afterAll(async () => {
  await harness.db.user.deleteMany({ where: { id: owner.id } });
  await harness.close();
}, 300_000);

describe('results at scale', () => {
  it(`reads ${String(ROWS)} responses' unfiltered report from the counters within ${String(UNFILTERED_P95_BUDGET_MS)} ms p95`, async () => {
    const { timings, body } = await timed(`/forms/${form.id}/results`, false);
    console.info(
      `[scale] unfiltered (counters): p50 ${p50(timings).toFixed(0)} ms, p95 ${p95(timings).toFixed(0)} ms`,
    );
    expect(body.totals.completed).toBe(ROWS);
    expect(body.cached).toBe(false);
    expect(p95(timings)).toBeLessThan(UNFILTERED_P95_BUDGET_MS);
  }, 300_000);

  it('scans a filtered report within its budget, uncached', async () => {
    const { timings, body } = await timed(
      `/forms/${form.id}/results?filterField=f_role0001&filterValue=o_manager1`,
      true,
    );
    console.info(
      `[scale] filtered (GIN + scan, ~30% of rows): p50 ${p50(timings).toFixed(0)} ms, p95 ${p95(timings).toFixed(0)} ms`,
    );
    expect(body.cached).toBe(false);
    expect(body.totals.completed).toBeGreaterThan(ROWS * 0.25);
    expect(body.totals.completed).toBeLessThan(ROWS * 0.35);
    expect(p95(timings)).toBeLessThan(FILTERED_P95_BUDGET_MS);
  }, 300_000);

  it('serves a repeated filtered report from the cache', async () => {
    const path = `/forms/${form.id}/results?filterField=f_role0001&filterValue=o_student1`;
    await call(harness, 'GET', path, { user: owner });
    const reply = await call<{ cached: boolean }>(harness, 'GET', path, { user: owner });
    expect(reply.body.cached).toBe(true);
  });
});
