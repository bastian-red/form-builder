/**
 * Results and export against the seeded form, checked against direct SQL so the
 * aggregation is compared with an independent count rather than with itself.
 */
import type { Results } from '@forms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADA, boot, call, loadSeed, type Harness } from './support';

let harness: Harness;
let formId: string;

beforeAll(async () => {
  harness = await boot();
  ({ formId } = await loadSeed(harness.db));
});

afterAll(async () => {
  await harness.close();
});

async function results(query = ''): Promise<Results> {
  const reply = await call<Results>(harness, 'GET', `/forms/${formId}/results${query}`, {
    user: ADA,
  });
  expect(reply.status, reply.text).toBe(200);
  return reply.body;
}

describe('results', () => {
  it('defaults to the latest version and agrees with a direct count', async () => {
    const body = await results();
    expect(body.version).toBe(2);
    const [direct] = await harness.db.$queryRaw<Array<{ started: number; completed: number }>>`
      SELECT count(*)::int AS started, count(submitted_at)::int AS completed
        FROM responses WHERE form_version_id = ${body.versionId}`;
    expect(body.totals.started).toBe(direct!.started);
    expect(body.totals.completed).toBe(direct!.completed);
    expect(body.totals.medianSecondsToComplete).toBeGreaterThan(0);
  });

  it('counts each role option exactly as SQL does', async () => {
    const body = await results();
    const role = body.fields.find((field) => field.fieldId === 'f_role0001')!;
    const rows = await harness.db.$queryRaw<Array<{ value: string; n: number }>>`
      SELECT answers ->> 'f_role0001' AS value, count(*)::int AS n FROM responses
       WHERE form_version_id = ${body.versionId} AND submitted_at IS NOT NULL GROUP BY 1`;
    const direct = new Map(rows.map((row) => [row.value, row.n]));
    if (role.result.kind !== 'choice') throw new Error('role should be a choice result');
    for (const option of role.result.options)
      expect(option.count, option.label).toBe(direct.get(option.optionId) ?? 0);
  });

  it('shows the manager-only question as reached only by managers', async () => {
    const body = await results();
    const role = body.fields.find((field) => field.fieldId === 'f_role0001')!;
    const team = body.fields.find((field) => field.fieldId === 'f_teamsiz1')!;
    if (role.result.kind !== 'choice') throw new Error('role should be a choice result');
    const managers = role.result.options.find((option) => option.label === 'Manager')!.count;
    expect(team.reached).toBe(managers);
    expect(team.answered).toBe(managers);
  });

  it('reads an unfiltered report from the counters, which agree with a recount', async () => {
    // The seed rebuilt them with recount; this asserts the read path and the
    // rows agree, independently of the counters, on the headline numbers.
    const body = await results();
    expect(body.cached).toBe(false);
    const [direct] = await harness.db.$queryRaw<Array<{ completed: number }>>`
      SELECT count(*)::int AS completed FROM responses WHERE form_version_id = ${body.versionId} AND submitted_at IS NOT NULL`;
    expect(body.totals.completed).toBe(direct!.completed);
  });

  it('serves a repeated filtered request from the cache', async () => {
    const query = '?filterField=f_role0001&filterValue=o_enginee1';
    expect((await results(query)).cached).toBe(false);
    expect((await results(query)).cached).toBe(true);
  });

  it("keeps version 1 on version 1's questions", async () => {
    const v1 = await results('?version=1');
    expect(v1.version).toBe(1);
    // The date question only exists from version 2.
    expect(v1.fields.map((field) => field.fieldId)).not.toContain('f_started1');
    expect((await results()).fields.map((field) => field.fieldId)).toContain('f_started1');
  });

  it('filters every number by one answer', async () => {
    const all = await results();
    const managers = await results('?filterField=f_role0001&filterValue=o_manager1');
    expect(managers.filter).toEqual({ fieldId: 'f_role0001', value: 'o_manager1' });
    const role = managers.fields.find((field) => field.fieldId === 'f_role0001')!;
    if (role.result.kind !== 'choice') throw new Error('role should be a choice result');
    expect(
      role.result.options.filter((option) => option.count > 0).map((option) => option.label),
    ).toEqual(['Manager']);
    expect(managers.totals.completed).toBeLessThan(all.totals.completed);
  });

  it('refuses a filter on free text', async () => {
    const reply = await call(
      harness,
      'GET',
      `/forms/${formId}/results?filterField=f_love0001&filterValue=x`,
      { user: ADA },
    );
    expect(reply.status).toBe(400);
  });
});

describe('the response table', () => {
  it('pages by keyset without repeating or skipping a row', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let total = 0;
    do {
      const reply: { body: { rows: Array<{ id: string }>; next: string | null; total: number } } =
        await call(
          harness,
          'GET',
          `/forms/${formId}/responses${cursor === null ? '' : `?cursor=${cursor}`}`,
          { user: ADA },
        );
      total = reply.body.total;
      for (const row of reply.body.rows) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = reply.body.next;
    } while (cursor !== null);
    expect(seen.size).toBe(total);
  });
});

describe('the CSV export', () => {
  it("streams one line per completed response with that version's columns", async () => {
    for (const version of [1, 2]) {
      const reply = await call(
        harness,
        'GET',
        `/forms/${formId}/export.csv?version=${String(version)}`,
        { user: ADA },
      );
      expect(reply.status).toBe(200);
      expect(reply.headers.get('content-type')).toContain('text/csv');
      expect(reply.headers.get('content-disposition')).toBe(
        `attachment; filename="product-feedback-survey-v${String(version)}.csv"`,
      );
      const lines = reply.text
        .replace(/^\uFEFF/u, '')
        .trimEnd()
        .split('\r\n');
      const header = lines[0]!;
      expect(
        header.startsWith('response_id,version,submitted_at,What best describes your role?'),
      ).toBe(true);
      expect(header.includes('When did you start using us?')).toBe(version === 2);
      const completed = await harness.db.response.count({
        where: { form: { id: formId }, formVersion: { version }, submittedAt: { not: null } },
      });
      expect(lines.length - 1).toBe(completed);
    }
  });
});
