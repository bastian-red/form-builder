/**
 * The guard, the two auth routes, and the auth budget.
 *
 * The first block is about the property that makes the rest of this API safe:
 * **the guard is registered globally, so a route is authenticated unless
 * somebody wrote `@Public()` on it.**
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADA, boot, call, loadSeed, randomAddress, type Harness } from './support';

let harness: Harness;
const createdEmails: string[] = [];

beforeAll(async () => {
  harness = await boot();
  await loadSeed(harness.db);
});

afterAll(async () => {
  if (createdEmails.length > 0)
    await harness.db.user.deleteMany({ where: { email: { in: createdEmails } } });
  await harness.close();
});

describe('the global session guard', () => {
  it.each([
    ['GET', '/forms'],
    ['POST', '/forms'],
    ['GET', '/forms/cnosuchform00000000000000'],
    ['PUT', '/forms/cnosuchform00000000000000/draft'],
    ['POST', '/forms/cnosuchform00000000000000/publish'],
    ['GET', '/forms/cnosuchform00000000000000/results'],
    ['GET', '/forms/cnosuchform00000000000000/export.csv'],
  ])('refuses %s %s with no token', async (method, path) => {
    const reply = await call(harness, method, path, { user: null });
    expect(reply.status).toBe(401);
    expect(reply.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses a token signed with another secret, without saying which half was wrong', async () => {
    const reply = await call(harness, 'GET', '/forms', {
      user: ADA,
      secret: 'a-completely-different-secret-value',
    });
    expect(reply.status).toBe(401);
    expect(reply.body).toEqual({
      code: 'UNAUTHENTICATED',
      message: 'That token was not accepted.',
    });
  });

  it("admits a token this secret minted, and lists that user's forms", async () => {
    const reply = await call<Array<{ title: string }>>(harness, 'GET', '/forms', { user: ADA });
    expect(reply.status).toBe(200);
    // Content, not the status: the seeded titles only a working query returns.
    expect(reply.body.map((form) => form.title)).toEqual([
      'Team offsite poll',
      'Product feedback survey',
    ]);
  });

  it('leaves /health public and has it really ask both dependencies', async () => {
    const reply = await call<{ status: string; checks: Array<{ name: string; status: string }> }>(
      harness,
      'GET',
      '/health',
      {
        user: null,
      },
    );
    expect(reply.status).toBe(200);
    expect(reply.body.status).toBe('ok');
    expect(reply.body.checks.map((check) => `${check.name}:${check.status}`).sort()).toEqual([
      'postgres:ok',
      'redis:ok',
    ]);
  });
});

describe('sign up and sign in', () => {
  it('creates an account and signs into it', async () => {
    const email = `probe-${String(Date.now())}@forms.test`;
    createdEmails.push(email);
    const created = await call<{ id: string; email: string }>(harness, 'POST', '/auth/sign-up', {
      user: null,
      body: { email, name: 'A Probe', password: 'a-long-enough-password' },
    });
    expect(created.status).toBe(201);
    const signedIn = await call<{ id: string }>(harness, 'POST', '/auth/sign-in', {
      user: null,
      body: { email, password: 'a-long-enough-password' },
    });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.id).toBe(created.body.id);
  });

  it('refuses a second account on one address, by constraint name', async () => {
    const reply = await call(harness, 'POST', '/auth/sign-up', {
      user: null,
      body: { email: ADA.email, name: 'Not Ada', password: 'a-long-enough-password' },
    });
    expect(reply.status).toBe(409);
    expect(reply.body).toMatchObject({ code: 'CONFLICT' });
  });

  it('answers a wrong password exactly as it answers an unknown address', async () => {
    const wrong = await call(harness, 'POST', '/auth/sign-in', {
      user: null,
      body: { email: ADA.email, password: 'not-the-right-password' },
    });
    const unknown = await call(harness, 'POST', '/auth/sign-in', {
      user: null,
      body: { email: 'nobody-at-all@forms.test', password: 'not-the-right-password' },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual(unknown.body);
  });
});

describe('the auth budget', () => {
  it('limits sign-in per address, and does NOT limit the rest of the API', async () => {
    // RATE_LIMIT_AUTH is 5 in .env.example. Six attempts from one address: the
    // sixth is refused.
    const address = randomAddress();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const reply = await call(harness, 'POST', '/auth/sign-in', {
        user: null,
        address,
        body: { email: 'nobody@forms.test', password: 'wrong-password-123' },
      });
      statuses.push(reply.status);
    }
    expect(statuses.slice(0, 5).every((status) => status === 400)).toBe(true);
    expect(statuses[5]).toBe(429);

    // The regression this pins: with an unscoped named throttler, the 5/min
    // auth budget applied to every route. Ten list calls in a row must pass.
    for (let i = 0; i < 10; i += 1) {
      expect((await call(harness, 'GET', '/forms', { user: ADA, address })).status).toBe(200);
    }
  });
});
