#!/usr/bin/env node
/**
 * Prove the live database matches what the repository says it should be.
 *
 * Two checks, because neither one covers the other.
 *
 * **1. `prisma migrate diff` against the datamodel.** `prisma migrate status`
 * does NOT do this, and believing it does is how this project's database spent a
 * day carrying a schema no migration file described. Measured on 2026-08-26,
 * after `20260825120000_init/migration.sql` was edited to remove a generated
 * `search` column:
 *
 *     $ prisma migrate status
 *     2 migrations found in prisma/migrations
 *     Database schema is up to date!
 *
 *     $ psql -c '\d documents'
 *     search | tsvector | generated always as (...) stored
 *
 *     $ sha256sum .../20260825120000_init/migration.sql
 *     fe86c89f...                       # _prisma_migrations says fd3bb212...
 *
 * `migrate status` reads the LEDGER -- which migration names have a
 * `finished_at` -- and never compares a column. An already-applied migration
 * that is edited afterwards is invisible to it, including the checksum change.
 *
 * **2. The raw-SQL objects, by name.** The diff in check 1 is blind to
 * everything Prisma's datamodel cannot express, which in this project is the
 * entire `form_invariants` migration: the CHECK constraints, the one-owner
 * partial index, and the full-text GIN index on an EXPRESSION. Prisma would
 * report "no difference" against a database with none of them. So they are
 * asserted here by name, against `packages/db/src/constraints.ts`.
 *
 *   node scripts/db-drift.mjs
 *
 * 0 = the database matches. 1 = drift, with the SQL that would close it.
 * 2 = the check could not run, which is not the same as a pass.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPackage = join(repoRoot, 'packages', 'db');

function fail(message, detail) {
  console.error(`db-drift: ${message}`);
  if (detail !== undefined) console.error(`\n${detail}\n`);
  process.exit(1);
}

function cannotRun(message, detail) {
  console.error(`db-drift: ${message}`);
  if (detail !== undefined) console.error(`\n${detail}\n`);
  process.exit(2);
}

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') {
  cannotRun('DATABASE_URL is not set. Source .env first, or run this through pnpm db:drift.');
}

// --- 1. The datamodel diff -------------------------------------------------

let diffSql;
try {
  diffSql = execFileSync(
    'pnpm',
    [
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--from-url',
      databaseUrl,
      // Relative to `cwd` below, which is packages/db.
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--script',
    ],
    { cwd: dbPackage, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (error) {
  // Stderr is reported rather than discarded: a prisma that cannot reach the
  // database exits non-zero with the reason there, and swallowing it turns
  // "the check could not run" into "the check passed".
  cannotRun('prisma migrate diff failed to run.', `${error.stdout ?? ''}${error.stderr ?? ''}`);
}

const meaningful = diffSql.trim();
if (meaningful !== '' && !/this is an empty migration/iu.test(meaningful)) {
  fail(
    'the database does NOT match packages/db/prisma/schema.prisma. Prisma would need:',
    `${meaningful}\n\nReapply the migrations to a fresh database. Do not edit the schema to match the drift.`,
  );
}

// --- 2. The objects Prisma's datamodel cannot see --------------------------

const { PrismaClient } = await import(join(dbPackage, 'generated', 'client', 'index.js')).then(
  (module) => module.default ?? module,
);
const {
  CHECK_CONSTRAINTS,
  FOREIGN_KEYS,
  INDEXES,
  RESPONSES_ANSWERS_GIN,
  TRIGGERS,
  UNIQUE_INDEXES,
} = await import(join(dbPackage, 'dist', 'index.js')).then((module) => module.default ?? module);

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
try {
  const constraints = await prisma.$queryRaw`
    SELECT conname, contype FROM pg_constraint WHERE contype IN ('c', 'f')
  `;
  const checks = new Set(
    constraints.filter((row) => row.contype === 'c').map((row) => row.conname),
  );
  const foreign = new Set(
    constraints.filter((row) => row.contype === 'f').map((row) => row.conname),
  );

  const missingChecks = Object.values(CHECK_CONSTRAINTS).filter((name) => !checks.has(name));
  if (missingChecks.length > 0) {
    fail(
      `${missingChecks.length} CHECK constraint(s) from the form_invariants migration are not in the database.`,
      missingChecks.join('\n'),
    );
  }
  const missingForeign = Object.values(FOREIGN_KEYS).filter((name) => !foreign.has(name));
  if (missingForeign.length > 0) fail('foreign key(s) missing.', missingForeign.join('\n'));

  const indexes = await prisma.$queryRaw`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
  `;
  const byName = new Map(indexes.map((row) => [row.indexname, row.indexdef]));
  for (const name of [...Object.values(UNIQUE_INDEXES), ...Object.values(INDEXES)]) {
    if (!byName.has(name)) fail(`the ${name} index is not in the database.`);
  }
  // The operator class is the part `prisma migrate diff` cannot see and the
  // part that matters: a GIN index with the default jsonb_ops still serves @>,
  // but is larger and slower, and nothing would ever say so.
  if (!/jsonb_path_ops/u.test(byName.get(RESPONSES_ANSWERS_GIN))) {
    fail(
      `${RESPONSES_ANSWERS_GIN} is not built with jsonb_path_ops.`,
      byName.get(RESPONSES_ANSWERS_GIN),
    );
  }

  const triggers = await prisma.$queryRaw`
    SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
  `;
  const present = new Set(triggers.map((row) => row.tgname));
  const missingTriggers = Object.values(TRIGGERS).filter((name) => !present.has(name));
  if (missingTriggers.length > 0) {
    fail(
      'immutability trigger(s) missing: published versions or submitted responses could be edited.',
      missingTriggers.join('\n'),
    );
  }

  // The index existing is not the same as the results filter being able to USE
  // it. With every other access path disabled, the planner must reach the GIN
  // index for the exact predicate `services/analytics` writes. The settings are
  // session-local and this connection is discarded immediately after.
  await prisma.$executeRawUnsafe('SET enable_seqscan = off');
  await prisma.$executeRawUnsafe('SET enable_indexscan = off');
  await prisma.$executeRawUnsafe('SET enable_indexonlyscan = off');
  const plan = await prisma.$queryRawUnsafe(
    `EXPLAIN (FORMAT TEXT) SELECT id FROM responses r WHERE r.answers @> $1::jsonb`,
    '{"f_aaaaaaaa":"o_aaaaaaaa"}',
  );
  const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
  if (!planText.includes(RESPONSES_ANSWERS_GIN)) {
    fail('the results filter predicate does not plan onto the GIN index.', planText);
  }

  console.log(
    'db-drift: the database matches the schema, the CHECKs, the foreign key and the indexes.',
  );
  console.log('db-drift: both immutability triggers are installed.');
  console.log(`db-drift: answers @> plans onto ${RESPONSES_ANSWERS_GIN} (jsonb_path_ops).`);
} finally {
  await prisma.$disconnect();
}
