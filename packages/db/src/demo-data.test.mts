import { reachedPath, validateSubmission, walk } from '@forms/form-logic';
import { analyze } from '@forms/form-logic';
import { describe, expect, it } from 'vitest';

import { DEMO_V1, DEMO_V2, OFFSITE_DRAFT, prng, respondents, uuid } from '../prisma/demo-data.mjs';

/**
 * The seed stores only what the API would have accepted. Without this, the
 * results page could demonstrate answers that cannot exist -- a student's team
 * size, a promoter's "what should we improve" -- and nobody would notice,
 * because a seed is never validated by anything else.
 */
const FROM = new Date('2026-09-01T09:00:00.000Z');

describe('the demo forms', () => {
  it.each([
    ['v1', DEMO_V1],
    ['v2', DEMO_V2],
    ['offsite draft', OFFSITE_DRAFT],
  ])('%s passes the analyzer with no issue at all', (_name, definition) => {
    expect(analyze(definition)).toEqual([]);
  });
});

describe.each([
  ['v1', DEMO_V1, 1],
  ['v2', DEMO_V2, 2],
])('respondents on %s', (_name, definition, seed) => {
  const rows = respondents(definition, { seed, count: 300, abandonRate: 0.2, from: FROM, spacingMinutes: 60 });

  it('are accepted by the server-side validator, finished or not', () => {
    for (const row of rows) {
      const verdict = validateSubmission(definition, row.answers, { complete: row.submittedAt !== null });
      expect(verdict.problems, row.id).toEqual([]);
    }
  });

  it('record exactly the reached path the API would compute', () => {
    for (const row of rows) {
      const path = walk(definition, row.answers);
      const current = row.submittedAt === null ? row.reached.at(-1)! : null;
      expect(reachedPath(path, current), row.id).toEqual(row.reached);
    }
  });

  it('include both branches, abandoned responses and unique ids', () => {
    expect(rows.some((row) => row.submittedAt === null)).toBe(true);
    expect(rows.some((row) => 'f_teamsiz1' in row.answers)).toBe(true);
    expect(rows.some((row) => 'f_improv01' in row.answers)).toBe(true);
    expect(rows.some((row) => 'f_love0001' in row.answers)).toBe(true);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it('are deterministic', () => {
    const again = respondents(definition, { seed, count: 300, abandonRate: 0.2, from: FROM, spacingMinutes: 60 });
    expect(again).toEqual(rows);
  });
});

describe('uuid', () => {
  it('has the v4 shape responseIdSchema accepts', () => {
    const random = prng(7);
    for (let i = 0; i < 100; i += 1) {
      expect(uuid(random)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    }
  });
});
