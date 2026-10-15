/**
 * The respondent's side, through the real stack: the server walks the logic
 * itself, a retried save is one row, a submitted response is final.
 */
import { randomUUID } from 'node:crypto';

import type { SessionUser } from '@forms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BRANCHING,
  boot,
  call,
  counterSnapshot,
  newAuthor,
  publishedForm,
  randomAddress,
  recountNow,
  type Harness,
} from './support';

let harness: Harness;
let owner: SessionUser;
let form: { id: string; slug: string; versionId: string };

beforeAll(async () => {
  harness = await boot();
  owner = await newAuthor(harness.db, 'respond-owner');
  form = await publishedForm(harness, owner, BRANCHING);
});

afterAll(async () => {
  await harness.db.user.deleteMany({ where: { id: owner.id } });
  await harness.close();
});

function save(id: string, body: Record<string, unknown>, address?: string) {
  return call<{
    status?: string;
    code?: string;
    details?: Array<{ fieldId: string; code: string }>;
  }>(harness, 'PUT', `/public/responses/${id}`, {
    user: null,
    body: { formVersionId: form.versionId, currentFieldId: null, complete: false, ...body },
    ...(address ? { address } : {}),
  });
}

describe('the public form', () => {
  it('serves the latest published version by slug, with no token', async () => {
    const reply = await call<{ version: number; definition: { title: string } }>(
      harness,
      'GET',
      `/public/forms/${form.slug}`,
      {
        user: null,
      },
    );
    expect(reply.status).toBe(200);
    expect(reply.body.definition.title).toBe('Branching probe');
  });

  it('does not exist before it is published', async () => {
    const draft = await call<{ slug: string }>(harness, 'POST', '/forms', {
      user: owner,
      body: { title: 'Unpublished' },
    });
    expect(
      (await call(harness, 'GET', `/public/forms/${draft.body.slug}`, { user: null })).status,
    ).toBe(404);
  });
});

describe('saving answers', () => {
  it('accepts a complete student response and records the server-computed path', async () => {
    const id = randomUUID();
    const reply = await save(id, {
      answers: { f_role0001: 'o_student1', f_score001: 9, f_note0001: '  great  ' },
      complete: true,
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ status: 'completed' });
    const row = await harness.db.response.findUniqueOrThrow({ where: { id } });
    // Trimmed, and the manager question is not on a student's path.
    expect(row.answers).toEqual({ f_role0001: 'o_student1', f_score001: 9, f_note0001: 'great' });
    expect(row.reached).toEqual(['f_role0001', 'f_score001', 'f_note0001']);
    expect(row.submittedAt).not.toBeNull();
  });

  it('refuses an answer to a question the answers route around', async () => {
    // The scripted client: a student answering the manager-only question.
    const reply = await save(randomUUID(), {
      answers: { f_role0001: 'o_student1', f_team0001: 12, f_score001: 9 },
      complete: true,
    });
    expect(reply.status).toBe(422);
    expect(reply.body.details).toEqual([
      expect.objectContaining({ fieldId: 'f_team0001', code: 'hidden_answered' }),
    ]);
  });

  it('enforces required answers only on the final save', async () => {
    const id = randomUUID();
    expect(
      (await save(id, { answers: { f_role0001: 'o_manager1' }, currentFieldId: 'f_team0001' }))
        .status,
    ).toBe(200);
    const final = await save(id, { answers: { f_role0001: 'o_manager1' }, complete: true });
    expect(final.status).toBe(422);
    expect(final.body.details?.map((problem) => `${problem.fieldId}:${problem.code}`)).toEqual([
      'f_team0001:required',
      'f_score001:required',
    ]);
  });

  it('refuses a current question that the answers do not lead to', async () => {
    const reply = await save(randomUUID(), {
      answers: { f_role0001: 'o_student1' },
      currentFieldId: 'f_team0001',
    });
    expect(reply.status).toBe(400);
  });

  it('turns twenty concurrent identical saves into one row', async () => {
    const id = randomUUID();
    const body = { answers: { f_role0001: 'o_student1' }, currentFieldId: 'f_role0001' };
    const replies = await Promise.all(Array.from({ length: 20 }, () => save(id, body)));
    const failed = replies
      .filter((reply) => reply.status !== 200)
      .map((reply) => `${String(reply.status)} ${reply.text}`);
    expect(failed).toEqual([]);
    expect(await harness.db.response.count({ where: { id } })).toBe(1);
  });

  it('makes a submitted response final, but answers an identical retry as it did', async () => {
    const id = randomUUID();
    const answers = { f_role0001: 'o_student1', f_score001: 3 };
    expect((await save(id, { answers, complete: true })).status).toBe(200);
    // The retry whose first reply was lost.
    const retry = await save(id, { answers, complete: true });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ status: 'completed' });
    // Anything else is refused, and the stored row is untouched.
    const edit = await save(id, { answers: { ...answers, f_score001: 10 }, complete: true });
    expect(edit.status).toBe(409);
    const row = await harness.db.response.findUniqueOrThrow({ where: { id } });
    expect(row.answers).toEqual(answers);
    // And the database refuses even a direct UPDATE.
    await expect(
      harness.db.$executeRaw`UPDATE responses SET answers = '{}'::jsonb WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/immutable/u);
  });

  it('stores nothing when the honeypot is filled, and says it worked', async () => {
    const id = randomUUID();
    const reply = await save(id, {
      answers: { f_role0001: 'o_student1', f_score001: 9 },
      complete: true,
      website: 'http://spam.example',
    });
    expect(reply.status).toBe(200);
    expect(await harness.db.response.count({ where: { id } })).toBe(0);
  });

  it('refuses answers past the size ceiling', async () => {
    const reply = await save(randomUUID(), {
      answers: { f_role0001: 'o_student1', f_note0001: 'x'.repeat(5000) },
    });
    // 5,000 characters is under MAX_ANSWERS_BYTES (64 KB) but over the field's
    // own 500-character limit, so this one is a 422, not a 413...
    expect(reply.status).toBe(422);
  });

  it('answers 410 once the form is closed, for reads and saves', async () => {
    const closing = await publishedForm(harness, owner, { ...BRANCHING, title: 'Closing' });
    expect(
      (
        await call(harness, 'PATCH', `/forms/${closing.id}`, {
          user: owner,
          body: { accepting: false },
        })
      ).status,
    ).toBe(204);
    expect(
      (await call(harness, 'GET', `/public/forms/${closing.slug}`, { user: null })).status,
    ).toBe(410);
    const reply = await call(harness, 'PUT', `/public/responses/${randomUUID()}`, {
      user: null,
      body: {
        formVersionId: closing.versionId,
        answers: {},
        currentFieldId: null,
        complete: false,
      },
    });
    expect(reply.status).toBe(410);
  });
});

describe('the respond budget', () => {
  it('stops a script hammering saves from one address', async () => {
    // RATE_LIMIT_RESPOND is 120 per minute per address.
    // Its own address, fresh per run, so a previous run's spent budget (Redis
    // keeps the counter for a minute) cannot make this pass or fail.
    const address = randomAddress();
    const statuses: number[] = [];
    for (let i = 0; i < 125; i += 1) {
      statuses.push(
        (
          await save(
            randomUUID(),
            { answers: { f_role0001: 'o_student1' }, currentFieldId: 'f_role0001' },
            address,
          )
        ).status,
      );
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(120);
    expect(statuses.slice(120).every((status) => status === 429)).toBe(true);
  });
});

describe('a partial save followed by the final one', () => {
  it('completes, and is counted once as started and once as completed', async () => {
    // The path every real respondent takes. It once failed the version_stats
    // CHECK: the completing delta (started 0, completed 1) was proposed as an
    // INSERT row before ON CONFLICT could see the existing counters.
    const before = (await counterSnapshot(harness.db, form.versionId)) as {
      version: Array<{ started: number; completed: number }>;
    };
    const id = randomUUID();
    expect(
      (await save(id, { answers: { f_role0001: 'o_student1' }, currentFieldId: 'f_score001' }))
        .status,
    ).toBe(200);
    const final = await save(id, {
      answers: { f_role0001: 'o_student1', f_score001: 8 },
      complete: true,
    });
    expect(final.status).toBe(200);
    expect(final.body).toEqual({ status: 'completed' });
    const after = (await counterSnapshot(harness.db, form.versionId)) as typeof before;
    expect(after.version[0]!.started).toBe(before.version[0]!.started + 1);
    expect(after.version[0]!.completed).toBe(before.version[0]!.completed + 1);
  });
});

describe('the results counters', () => {
  it('equal a full recount after everything above, concurrency included', async () => {
    // The evidence that incremental counting does not drift: every save in this
    // file (twenty concurrent first saves, partial-then-final, refused edits,
    // retries, the 125-request flood) went through the delta path. A recount
    // rebuilds the same counters from the rows alone; the two must be equal.
    const incremental = await counterSnapshot(harness.db, form.versionId);
    await recountNow(harness.db, form.versionId, BRANCHING);
    expect(await counterSnapshot(harness.db, form.versionId)).toEqual(incremental);
  });

  it('take a field off the funnel when a respondent goes back and changes branch', async () => {
    const before = (await counterSnapshot(harness.db, form.versionId)) as {
      fields: Array<{ field_id: string; reached_all: number }>;
    };
    const reached = (snapshot: typeof before, id: string) =>
      snapshot.fields.find((row) => row.field_id === id)?.reached_all ?? 0;
    const id = randomUUID();
    await save(id, { answers: { f_role0001: 'o_manager1' }, currentFieldId: 'f_team0001' });
    const asManager = (await counterSnapshot(harness.db, form.versionId)) as typeof before;
    expect(reached(asManager, 'f_team0001')).toBe(reached(before, 'f_team0001') + 1);
    await save(id, { answers: { f_role0001: 'o_student1' }, currentFieldId: 'f_role0001' });
    const asStudent = (await counterSnapshot(harness.db, form.versionId)) as typeof before;
    expect(reached(asStudent, 'f_team0001')).toBe(reached(before, 'f_team0001'));
  });
});
