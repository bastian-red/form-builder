import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as constraints from './constraints';

const MIGRATIONS = join(__dirname, '..', 'prisma', 'migrations');

/** Every migration's SQL, concatenated. Read from disk, never a copy. */
const sql = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readFileSync(join(MIGRATIONS, entry.name, 'migration.sql'), 'utf8'))
  .join('\n');

/** Strip SQL line comments so a name mentioned only in prose does not count. */
const statements = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/** Every exported object name: constants that are not a client error code. */
const named = Object.entries(constraints)
  .filter(([key, value]) => typeof value === 'string' && /^[A-Z_]+$/u.test(key))
  .filter(([key]) => !key.startsWith('PRISMA_') && !key.startsWith('PG_'))
  .map(([key, value]) => [key, value as string] as const);

describe('every exported name exists in a migration', () => {
  // The failure this catches: a constraint renamed in the migration while the
  // catch block still matches the old name. Nothing errors -- the catch simply
  // stops firing, and a conflict that used to be a clean 409 becomes a 500.
  it('has a non-trivial number of them, so an empty export list cannot pass', () => {
    expect(named.length).toBeGreaterThan(15);
  });

  for (const [key, value] of named) {
    it(`${key} -> ${value}`, () => {
      expect(statements).toContain(`"${value}"`);
    });
  }
});

describe('the invariants migration carries the rules the design depends on', () => {
  // Named individually rather than counted, so deleting one is a failure with
  // the deleted rule's name in it.
  it.each([
    ['a published version cannot be edited', 'BEFORE UPDATE ON "form_versions"'],
    ['a submitted response cannot be edited', 'IF OLD."submitted_at" IS NOT NULL THEN'],
    [
      'a response and its version belong to one form',
      'REFERENCES "form_versions"("id", "form_id")',
    ],
    [
      'the filter index uses the operator class that serves @>',
      'USING GIN ("answers" jsonb_path_ops)',
    ],
    ['reached is never null', 'ALTER COLUMN "reached" SET NOT NULL'],
    ['version numbers start at 1', 'CHECK ("version" > 0)'],
  ])('%s', (_label, fragment) => {
    expect(statements).toContain(fragment);
  });

  it('pins the slug CHECK to the same pattern as slugSchema', async () => {
    // Two copies of one rule; this is the test that keeps them one rule.
    const { slugSchema } = await import('@forms/shared');
    const pattern = /CHECK \("slug" ~ '([^']+)'\)/u.exec(statements)?.[1];
    expect(pattern).toBeDefined();
    const regex = new RegExp(pattern!, 'u');
    for (const candidate of ['product-feedback', 'abcd', 'ABCD', '-abc', 'a/bc', 'x'.repeat(41)]) {
      expect(regex.test(candidate), candidate).toBe(slugSchema.safeParse(candidate).success);
    }
  });
});

describe('the grouped exports', () => {
  const groups = [
    constraints.CHECK_CONSTRAINTS,
    constraints.FOREIGN_KEYS,
    constraints.UNIQUE_INDEXES,
    constraints.INDEXES,
    constraints.TRIGGERS,
  ].map((group) => Object.values(group) as string[]);

  it('put every name in exactly one group', () => {
    // The groups are what `scripts/db-drift.mjs` iterates. A name in no group is
    // an object the drift check silently does not look for.
    for (const [, name] of named) {
      expect(
        groups.filter((group) => group.includes(name)),
        name,
      ).toHaveLength(1);
    }
  });

  it('cannot be mutated by a caller', () => {
    for (const group of [
      constraints.CHECK_CONSTRAINTS,
      constraints.INDEXES,
      constraints.TRIGGERS,
    ]) {
      expect(Object.isFrozen(group)).toBe(true);
    }
  });
});
