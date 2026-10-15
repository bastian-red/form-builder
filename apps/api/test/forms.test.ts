/**
 * The author's side: ownership, the draft's optimistic revision, publishing,
 * and the immutability the database enforces underneath.
 */
import type { FormDefinition, SessionUser } from '@forms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BRANCHING, boot, call, newAuthor, type Harness } from './support';

let harness: Harness;
let owner: SessionUser;
let stranger: SessionUser;

beforeAll(async () => {
  harness = await boot();
  owner = await newAuthor(harness.db, 'owner');
  stranger = await newAuthor(harness.db, 'stranger');
});

afterAll(async () => {
  await harness.db.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
  await harness.close();
});

async function create(title: string): Promise<string> {
  const reply = await call<{ id: string }>(harness, 'POST', '/forms', {
    user: owner,
    body: { title },
  });
  expect(reply.status).toBe(201);
  return reply.body.id;
}

describe('ownership', () => {
  it("answers 404, never 403, for somebody else's form, on every route", async () => {
    const id = await create('Private');
    for (const [method, path, body] of [
      ['GET', `/forms/${id}`, undefined],
      ['PUT', `/forms/${id}/draft`, { definition: { ...BRANCHING, title: 'Hijack' }, revision: 0 }],
      ['POST', `/forms/${id}/publish`, undefined],
      ['PATCH', `/forms/${id}`, { accepting: false }],
      ['DELETE', `/forms/${id}`, undefined],
      ['GET', `/forms/${id}/results`, undefined],
    ] as const) {
      const reply = await call(harness, method, path, { user: stranger, body });
      expect(reply.status, `${method} ${path}`).toBe(404);
    }
    // And nothing changed.
    const mine = await call<{ draft: FormDefinition }>(harness, 'GET', `/forms/${id}`, {
      user: owner,
    });
    expect(mine.body.draft.title).toBe('Private');
  });
});

describe('the draft', () => {
  it('saves with the revision it was based on and refuses a stale one', async () => {
    const id = await create('Revisions');
    const first = await call<{ revision: number }>(harness, 'PUT', `/forms/${id}/draft`, {
      user: owner,
      body: { definition: { ...BRANCHING, title: 'Tab A' }, revision: 0 },
    });
    expect(first.body).toEqual({ revision: 1 });

    // A second tab still at revision 0.
    const stale = await call(harness, 'PUT', `/forms/${id}/draft`, {
      user: owner,
      body: { definition: { ...BRANCHING, title: 'Tab B' }, revision: 0 },
    });
    expect(stale.status).toBe(409);
    const detail = await call<{ draft: FormDefinition; revision: number }>(
      harness,
      'GET',
      `/forms/${id}`,
      { user: owner },
    );
    expect(detail.body.draft.title).toBe('Tab A');
    expect(detail.body.revision).toBe(1);
  });

  it("saves a logically broken draft, because refusing would lose the author's work", async () => {
    const id = await create('Broken');
    const broken: FormDefinition = {
      ...BRANCHING,
      fields: BRANCHING.fields.map((field) =>
        field.id === 'f_note0001'
          ? { ...field, jumps: [{ when: { op: 'all', of: [] }, to: 'f_role0001' }] }
          : field,
      ),
    };
    const saved = await call(harness, 'PUT', `/forms/${id}/draft`, {
      user: owner,
      body: { definition: broken, revision: 0 },
    });
    expect(saved.status).toBe(200);
  });
});

describe('publishing', () => {
  it('refuses a backward jump with 422 and an issue naming both ends of the edge', async () => {
    const id = await create('Loop');
    const looping: FormDefinition = {
      ...BRANCHING,
      fields: BRANCHING.fields.map((field) =>
        field.id === 'f_score001'
          ? {
              ...field,
              jumps: [{ when: { op: 'lt', field: 'f_score001', value: 5 }, to: 'f_role0001' }],
            }
          : field,
      ),
    };
    await call(harness, 'PUT', `/forms/${id}/draft`, {
      user: owner,
      body: { definition: looping, revision: 0 },
    });
    const reply = await call<{
      code: string;
      details: Array<{ code: string; fieldId: string; ref: string }>;
    }>(harness, 'POST', `/forms/${id}/publish`, { user: owner });
    expect(reply.status).toBe(422);
    expect(reply.body.code).toBe('UNPROCESSABLE');
    expect(reply.body.details).toEqual([
      expect.objectContaining({ code: 'backward_jump', fieldId: 'f_score001', ref: 'f_role0001' }),
    ]);
    expect(await harness.db.formVersion.count({ where: { formId: id } })).toBe(0);
  });

  it('cuts version 1, is idempotent while nothing changes, then cuts version 2', async () => {
    const id = await create('Versions');
    await call(harness, 'PUT', `/forms/${id}/draft`, {
      user: owner,
      body: { definition: BRANCHING, revision: 0 },
    });
    const v1 = await call<{ version: number; created: boolean }>(
      harness,
      'POST',
      `/forms/${id}/publish`,
      { user: owner },
    );
    expect(v1.body).toMatchObject({ version: 1, created: true });
    const again = await call<{ version: number; created: boolean }>(
      harness,
      'POST',
      `/forms/${id}/publish`,
      { user: owner },
    );
    expect(again.body).toMatchObject({ version: 1, created: false });

    await call(harness, 'PUT', `/forms/${id}/draft`, {
      user: owner,
      body: { definition: { ...BRANCHING, title: 'Versions, edited' }, revision: 1 },
    });
    const v2 = await call<{ version: number; created: boolean }>(
      harness,
      'POST',
      `/forms/${id}/publish`,
      { user: owner },
    );
    expect(v2.body).toMatchObject({ version: 2, created: true });
  });

  it('serializes concurrent publishes: five at once cut exactly one version', async () => {
    const id = await create('Race');
    await call(harness, 'PUT', `/forms/${id}/draft`, {
      user: owner,
      body: { definition: BRANCHING, revision: 0 },
    });
    const replies = await Promise.all(
      Array.from({ length: 5 }, () =>
        call<{ version: number }>(harness, 'POST', `/forms/${id}/publish`, { user: owner }),
      ),
    );
    expect(replies.map((reply) => reply.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(replies.map((reply) => reply.body.version))).toEqual(new Set([1]));
    expect(await harness.db.formVersion.count({ where: { formId: id } })).toBe(1);
  });

  it('reports unpublished changes in the list and the detail', async () => {
    const id = await create('Dirty');
    await call(harness, 'PUT', `/forms/${id}/draft`, {
      user: owner,
      body: { definition: BRANCHING, revision: 0 },
    });
    await call(harness, 'POST', `/forms/${id}/publish`, { user: owner });
    const clean = await call<
      Array<{ id: string; unpublishedChanges: boolean; latestVersion: number }>
    >(harness, 'GET', '/forms', {
      user: owner,
    });
    expect(clean.body.find((form) => form.id === id)).toMatchObject({
      unpublishedChanges: false,
      latestVersion: 1,
    });

    await call(harness, 'PUT', `/forms/${id}/draft`, {
      user: owner,
      body: { definition: { ...BRANCHING, title: 'Dirty now' }, revision: 1 },
    });
    const dirty = await call<{ unpublishedChanges: boolean }>(harness, 'GET', `/forms/${id}`, {
      user: owner,
    });
    expect(dirty.body.unpublishedChanges).toBe(true);
  });
});

describe('the database refuses what the application never does', () => {
  it('will not let a published version be edited', async () => {
    const id = await create('Frozen');
    await call(harness, 'PUT', `/forms/${id}/draft`, {
      user: owner,
      body: { definition: BRANCHING, revision: 0 },
    });
    await call(harness, 'POST', `/forms/${id}/publish`, { user: owner });
    await expect(
      harness.db
        .$executeRaw`UPDATE form_versions SET definition = '{}'::jsonb WHERE form_id = ${id}`,
    ).rejects.toThrow(/immutable/u);
  });
});
