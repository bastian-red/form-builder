/**
 * Shared plumbing for the API's integration lane.
 *
 * The Nest application is built from the real `AppModule` and listens on an
 * ephemeral port, so every request below travels the whole stack: the session
 * guard, the throttler, the pipes, the filter, Prisma, Postgres, Redis. Nothing
 * is mocked, because what this lane exists to catch -- a guard that is not
 * default-closed, an upsert that is not idempotent, a trigger that is missing --
 * is a failure of the wiring rather than of a pure function, and the pure
 * functions already have their own tests.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createPrismaClient, type PrismaClient } from '@forms/db';
import type { FormDefinition, SessionUser } from '@forms/shared';
import { mintServiceToken } from '@forms/shared/server';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';

import { AppModule } from '../src/app.module';

export const AUTH_SECRET = required('AUTH_SECRET', process.env.AUTH_SECRET);
export const DATABASE_URL = required('DATABASE_URL', process.env.DATABASE_URL);
export const REDIS_URL = required('REDIS_URL', process.env.REDIS_URL);

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. Run this through ./scripts/integration.sh.`);
  }
  return value;
}

export interface Harness {
  readonly base: string;
  readonly db: PrismaClient;
  readonly redis: Redis;
  close(): Promise<void>;
}

export async function boot(): Promise<Harness> {
  // The same body parser and proxy trust main.ts sets up, so the harness runs
  // the program that ships.
  const app = await NestFactory.create<
    INestApplication & { set(key: string, value: unknown): void }
  >(AppModule, {
    logger: ['error'],
  });
  app.set('trust proxy', 1);
  app.enableShutdownHooks();
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer() as { address(): AddressInfo | string | null };
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('the API did not bind a port');

  const db = createPrismaClient({ url: DATABASE_URL });
  const redis = new Redis(REDIS_URL);
  return {
    base: `http://127.0.0.1:${String(address.port)}`,
    db,
    redis,
    close: async () => {
      await db.$disconnect();
      redis.disconnect();
      await app.close();
    },
  };
}

/** The seeded author, id filled in by `loadSeed`. */
export const ADA: SessionUser = { id: '', email: 'ada@forms.test', name: 'Ada Okafor' };
export const SEEDED_FORM_SLUG = 'product-feedback';

export async function loadSeed(db: PrismaClient): Promise<{ formId: string }> {
  const user = await db.user.findUniqueOrThrow({
    where: { email: ADA.email },
    select: { id: true },
  });
  ADA.id = user.id;
  const form = await db.form.findUniqueOrThrow({
    where: { slug: SEEDED_FORM_SLUG },
    select: { id: true },
  });
  return { formId: form.id };
}

/** A fresh author for a test that must not see the seed's rows. */
export async function newAuthor(db: PrismaClient, label: string): Promise<SessionUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@forms.test`;
  const row = await db.user.create({
    data: { email, name: label, passwordHash: 'not-a-real-hash' },
    select: { id: true },
  });
  return { id: row.id, email, name: label };
}

export interface Reply<T = unknown> {
  readonly status: number;
  readonly body: T;
  readonly headers: Headers;
  readonly text: string;
}

/** A private address, random per call, so per-address budgets never leak between tests. */
export function randomAddress(): string {
  const octet = () => String(1 + Math.floor(Math.random() * 254));
  return `10.${octet()}.${octet()}.${octet()}`;
}

/**
 * One request.
 *
 * The token is minted per call rather than cached: a cached one works for two
 * minutes and then fails for the rest of the run, and that looks like
 * flakiness. `user: null` sends no `Authorization` header, which is how the
 * default-closed guard and the public routes are exercised. Anonymous calls get
 * a fresh `x-forwarded-for` each unless `address` pins one, so per-address
 * budgets do not leak between tests.
 */
export async function call<T = unknown>(
  harness: Harness,
  method: string,
  path: string,
  options: { user?: SessionUser | null; body?: unknown; secret?: string; address?: string } = {},
): Promise<Reply<T>> {
  const headers: Record<string, string> = { 'x-forwarded-for': options.address ?? randomAddress() };
  if (options.user !== null && options.user !== undefined) {
    headers.authorization = `Bearer ${mintServiceToken(options.user, options.secret ?? AUTH_SECRET)}`;
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${harness.base}${path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let body: unknown = undefined;
  try {
    body = text === '' ? undefined : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body: body as T, headers: response.headers, text };
}

/** Create a form through the API, put `definition` in its draft, publish it. */
export async function publishedForm(
  harness: Harness,
  owner: SessionUser,
  definition: FormDefinition,
): Promise<{ id: string; slug: string; versionId: string }> {
  const created = await call<{ id: string; slug: string }>(harness, 'POST', '/forms', {
    user: owner,
    body: { title: definition.title },
  });
  if (created.status !== 201) throw new Error(`create: ${String(created.status)} ${created.text}`);
  const saved = await call(harness, 'PUT', `/forms/${created.body.id}/draft`, {
    user: owner,
    body: { definition, revision: 0 },
  });
  if (saved.status !== 200) throw new Error(`draft: ${String(saved.status)} ${saved.text}`);
  const published = await call<{ versionId: string }>(
    harness,
    'POST',
    `/forms/${created.body.id}/publish`,
    {
      user: owner,
    },
  );
  if (published.status !== 200)
    throw new Error(`publish: ${String(published.status)} ${published.text}`);
  return { ...created.body, versionId: published.body.versionId };
}

/** A small form with one branch, used by the respond and results suites. */
export const BRANCHING: FormDefinition = {
  schemaVersion: 1,
  title: 'Branching probe',
  ending: { title: 'Done', message: '' },
  fields: [
    {
      id: 'f_role0001',
      type: 'single_choice',
      title: 'Role',
      required: true,
      options: [
        { id: 'o_student1', label: 'Student' },
        { id: 'o_manager1', label: 'Manager' },
      ],
    },
    {
      id: 'f_team0001',
      type: 'number',
      title: 'Team size',
      required: true,
      integer: true,
      min: 1,
      max: 100,
      showIf: { op: 'eq', field: 'f_role0001', value: 'o_manager1' },
    },
    { id: 'f_score001', type: 'nps', title: 'Recommend?', required: true },
    {
      id: 'f_note0001',
      type: 'long_text',
      title: 'Anything else?',
      required: false,
      maxLength: 500,
    },
  ],
};

/** The counters of one version as plain rows, sorted, for an equality check. */
export async function counterSnapshot(db: PrismaClient, versionId: string): Promise<unknown> {
  const [version, fields, answers, durations] = await Promise.all([
    db.$queryRaw`SELECT started, completed FROM version_stats WHERE form_version_id = ${versionId}`,
    db.$queryRaw`SELECT field_id, reached_all, reached_completed, answered FROM field_stats
                  WHERE form_version_id = ${versionId}
                    AND (reached_all <> 0 OR reached_completed <> 0 OR answered <> 0) ORDER BY field_id`,
    db.$queryRaw`SELECT field_id, value::text AS value, count FROM answer_stats
                  WHERE form_version_id = ${versionId} AND count <> 0 ORDER BY field_id, value::text`,
    db.$queryRaw`SELECT seconds, count FROM duration_stats WHERE form_version_id = ${versionId} AND count <> 0 ORDER BY seconds`,
  ]);
  return { version, fields, answers, durations };
}

/** Rebuild a version's counters from its rows, as `pnpm db:recount` does. */
export async function recountNow(
  db: PrismaClient,
  versionId: string,
  definition: FormDefinition,
): Promise<void> {
  const { recount } = await import('@forms/analytics');
  await db.$transaction(async (tx) =>
    recount(
      ((sql: string, ...params: unknown[]) => tx.$queryRawUnsafe(sql, ...params)) as never,
      (sql: string, ...params: unknown[]) => tx.$executeRawUnsafe(sql, ...params),
      versionId,
      definition,
    ),
  );
}
