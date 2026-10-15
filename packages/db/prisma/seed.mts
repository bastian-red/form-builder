/**
 * The demo workspace: one account, one published form with two versions and a
 * few hundred responses, one unpublished draft.
 *
 * Five properties, each with the mechanism that holds it:
 *
 * 1. **Every response is one the API would have accepted.** They are generated
 *    by walking the real navigator (`demo-data.mts`), and
 *    `src/demo-data.test.ts` runs each through `validateSubmission`.
 * 2. **It is deterministic.** Fixed ids, a fixed reference instant, a seeded
 *    PRNG. Two runs produce the same rows, so the E2E suite and
 *    `scripts/seed-check.sh` can assert exact counts.
 * 3. **It is idempotent and touches only its own rows.** It deletes the two
 *    seeded forms by id (cascading to versions and responses) and the seeded
 *    user by id, then recreates them. Running it against a database somebody
 *    was using does not empty it.
 * 4. **The results counters agree with the rows.** Responses are bulk-inserted,
 *    so the counters are rebuilt from them with `recount`, not hand-written.
 * 5. **The constants are readable from outside.** `scripts/seed-check.sh` and
 *    `scripts/dev-smoke.sh` `sed` the `const NAME = '...'` lines below rather
 *    than repeating them. One line each, single quotes, no template literals.
 */
import { hashPassword } from '@forms/shared/server';
import { formDefinitionSchema, idSchema, slugSchema } from '@forms/shared';

import pkg from '../generated/client/index.js';
import { recountVersion } from './counters.mjs';
import { DEMO_V1, DEMO_V2, OFFSITE_DRAFT, respondents, type DemoResponse } from './demo-data.mjs';

const { PrismaClient } = pkg;

const DEMO_EMAIL = 'ada@forms.test';
const DEMO_PASSWORD = 'demo-password-2026';
const DEMO_FORM_TITLE = 'Product feedback survey';
const DEMO_FORM_SLUG = 'product-feedback';
const DEMO_FIRST_QUESTION = 'What best describes your role?';
const DRAFT_FORM_TITLE = 'Team offsite poll';

/** Response counts per version, read by seed-check.sh and asserted by E2E. */
const V1_RESPONSES = 140;
const V2_RESPONSES = 320;

/** Everything is anchored here, in UTC, so every machine seeds the same instants. */
const REFERENCE = new Date('2026-09-01T09:00:00.000Z');

/**
 * A fixed id that is still a valid one: `idSchema` wants 20-40 lowercase
 * alphanumerics (the shape `cuid()` produces), and every contract parses ids
 * through it, so a readable `seed-form` would be unreachable through the real
 * code paths. Checked against the schema before anything is written.
 */
function seedId(kind: string, name: string): string {
  return `c${kind}${name}${'0'.repeat(40)}`.slice(0, 25);
}

const USER_ID = seedId('user', 'ada');
const DEMO_FORM_ID = seedId('form', 'feedback');
const DRAFT_FORM_ID = seedId('form', 'offsite');
const V1_ID = seedId('version', 'feedbackone');
const V2_ID = seedId('version', 'feedbacktwo');

const prisma = new PrismaClient();

function assertSeedData(): void {
  for (const id of [USER_ID, DEMO_FORM_ID, DRAFT_FORM_ID, V1_ID, V2_ID]) idSchema.parse(id);
  slugSchema.parse(DEMO_FORM_SLUG);
  for (const definition of [DEMO_V1, DEMO_V2, OFFSITE_DRAFT]) formDefinitionSchema.parse(definition);
  if (DEMO_V1.title !== DEMO_FORM_TITLE) throw new Error('DEMO_FORM_TITLE drifted from the definition');
  if (DEMO_V1.fields[1]?.title !== DEMO_FIRST_QUESTION) throw new Error('DEMO_FIRST_QUESTION drifted');
  if (OFFSITE_DRAFT.title !== DRAFT_FORM_TITLE) throw new Error('DRAFT_FORM_TITLE drifted');
}

async function teardown(): Promise<void> {
  await prisma.form.deleteMany({ where: { id: { in: [DEMO_FORM_ID, DRAFT_FORM_ID] } } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
}

async function insertResponses(formVersionId: string, rows: readonly DemoResponse[]): Promise<void> {
  // Batches of 200: one statement per batch rather than per row, and small
  // enough to stay far below Postgres's 65,535 bind-parameter ceiling.
  for (let start = 0; start < rows.length; start += 200) {
    await prisma.response.createMany({
      data: rows.slice(start, start + 200).map((row) => ({
        id: row.id,
        formId: DEMO_FORM_ID,
        formVersionId,
        answers: row.answers,
        reached: row.reached,
        startedAt: row.startedAt,
        updatedAt: row.updatedAt,
        submittedAt: row.submittedAt,
      })),
    });
  }
}

async function main(): Promise<void> {
  assertSeedData();
  await teardown();

  await prisma.user.create({
    data: { id: USER_ID, email: DEMO_EMAIL, name: 'Ada Okafor', passwordHash: hashPassword(DEMO_PASSWORD) },
  });

  await prisma.form.create({
    data: {
      id: DEMO_FORM_ID,
      ownerId: USER_ID,
      slug: DEMO_FORM_SLUG,
      title: DEMO_V2.title,
      draft: DEMO_V2,
      draftRevision: 7,
      createdAt: REFERENCE,
      versions: {
        create: [
          { id: V1_ID, version: 1, definition: DEMO_V1, publishedAt: REFERENCE },
          { id: V2_ID, version: 2, definition: DEMO_V2, publishedAt: new Date(REFERENCE.getTime() + 14 * 86_400_000) },
        ],
      },
    },
  });

  await prisma.form.create({
    data: {
      id: DRAFT_FORM_ID,
      ownerId: USER_ID,
      slug: 'team-offsite',
      title: OFFSITE_DRAFT.title,
      draft: OFFSITE_DRAFT,
      draftRevision: 2,
      createdAt: REFERENCE,
    },
  });

  const v1 = respondents(DEMO_V1, { seed: 1, count: V1_RESPONSES, abandonRate: 0.2, from: REFERENCE, spacingMinutes: 140 });
  const v2From = new Date(REFERENCE.getTime() + 14 * 86_400_000);
  const v2 = respondents(DEMO_V2, { seed: 2, count: V2_RESPONSES, abandonRate: 0.18, from: v2From, spacingMinutes: 75 });
  await insertResponses(V1_ID, v1);
  await insertResponses(V2_ID, v2);

  // The responses were bulk-inserted, not saved through the API, so the results
  // counters are rebuilt from them -- by the same `recount` the repair command
  // and the integration lane's drift check use.
  await recountVersion(prisma, V1_ID, DEMO_V1);
  await recountVersion(prisma, V2_ID, DEMO_V2);

  // Pinned, because `updated_at` is `@updatedAt` and the form list orders by it.
  await prisma.$executeRaw`UPDATE forms SET updated_at = ${new Date(REFERENCE.getTime() + 30 * 86_400_000)} WHERE id = ${DEMO_FORM_ID}`;
  await prisma.$executeRaw`UPDATE forms SET updated_at = ${new Date(REFERENCE.getTime() + 31 * 86_400_000)} WHERE id = ${DRAFT_FORM_ID}`;

  const completed = [...v1, ...v2].filter((row) => row.submittedAt !== null).length;
  console.log(
    `Seeded 1 user, 2 forms ("${DEMO_FORM_TITLE}" v1+v2, "${DRAFT_FORM_TITLE}" draft), ` +
      `${String(v1.length + v2.length)} responses (${String(completed)} completed).`,
  );
  console.log(`Sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}; the public form is /f/${DEMO_FORM_SLUG}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
