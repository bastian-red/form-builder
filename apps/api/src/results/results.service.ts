/**
 * Results, the response table and the CSV export, for one version of one of
 * the caller's forms (docs/SPECS.md 7 and 8).
 *
 * The aggregation and its cache live in `services/analytics`; the CSV in
 * `services/response-export`. This file owns what neither should know about:
 * which version a request means, whose form it is, and how Prisma and Redis are
 * plugged into their ports.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  FILTERABLE_TYPES,
  parseFilterValue,
  versionResults,
  type RawQuery,
  type ResultsCache,
} from '@forms/analytics';
import { exportFilename, exportRows, type ExportRow } from '@forms/response-export';
import {
  DomainError,
  type AnswerValue,
  type FormDefinition,
  type Results,
  type ResultsQuery,
  type ResponsesPage,
  type VersionSummary,
} from '@forms/shared';

import { API_CONFIG, type ApiConfig } from '../config/config';
import { parseStored } from '../forms/forms.service';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';

interface ResolvedVersion {
  readonly id: string;
  readonly version: number;
  readonly definition: FormDefinition;
  readonly title: string;
  readonly versions: VersionSummary[];
}

/** An opaque keyset cursor: the last row's `(submitted_at, id)`. */
export function encodeCursor(submittedAt: Date, id: string): string {
  return Buffer.from(`${submittedAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { submittedAt: Date; id: string } {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const submittedAt = new Date(at ?? '');
  if (Number.isNaN(submittedAt.getTime()) || id === undefined || !/^[0-9a-f-]{36}$/u.test(id)) {
    throw new DomainError('INVALID', 'That page cursor is not one this server issued.');
  }
  return { submittedAt, id };
}

const EXPORT_PAGE = 500;

@Injectable()
export class ResultsService {
  private readonly raw: RawQuery;
  private readonly cache: ResultsCache;

  constructor(
    private readonly prisma: PrismaService,
    redis: RedisService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {
    // The two ports `@forms/analytics` takes. Every SQL string it passes is a
    // constant in that package and every value is a positional parameter.
    this.raw = ((sql: string, ...params: unknown[]) =>
      this.prisma.client.$queryRawUnsafe(sql, ...params)) as RawQuery;
    this.cache = {
      get: (key) => redis.client.get(key),
      set: async (key, value, ttlSeconds) => {
        await redis.client.set(key, value, 'EX', ttlSeconds);
      },
    };
  }

  /** The requested version of one of the owner's forms, or the latest one. */
  private async resolve(
    ownerId: string,
    formId: string,
    requested: number | undefined,
  ): Promise<ResolvedVersion> {
    const form = await this.prisma.client.form.findFirst({
      where: { id: formId, ownerId },
      select: {
        title: true,
        versions: {
          orderBy: { version: 'asc' },
          select: {
            id: true,
            version: true,
            publishedAt: true,
            definition: true,
            stats: { select: { completed: true } },
          },
        },
      },
    });
    if (form === null) throw new DomainError('NOT_FOUND', 'No such form.');
    const chosen =
      requested === undefined
        ? form.versions.at(-1)
        : form.versions.find((v) => v.version === requested);
    if (chosen === undefined) {
      throw new DomainError(
        'NOT_FOUND',
        requested === undefined ? 'This form has not been published yet.' : 'No such version.',
      );
    }

    return {
      id: chosen.id,
      version: chosen.version,
      definition: parseStored(chosen.definition),
      title: form.title,
      versions: form.versions.map((v) => ({
        id: v.id,
        version: v.version,
        publishedAt: v.publishedAt.toISOString(),
        responses: v.stats?.completed ?? 0,
      })),
    };
  }

  async results(ownerId: string, formId: string, query: ResultsQuery): Promise<Results> {
    const version = await this.resolve(ownerId, formId, query.version);

    let filter: { field: FormDefinition['fields'][number]; value: AnswerValue } | null = null;
    if (query.filterField !== undefined && query.filterValue !== undefined) {
      const field = version.definition.fields.find(
        (candidate) => candidate.id === query.filterField,
      );
      const value =
        field === undefined || !FILTERABLE_TYPES.has(field.type)
          ? null
          : parseFilterValue(field, query.filterValue);
      if (field === undefined || value === null) {
        throw new DomainError(
          'INVALID',
          'Results can be filtered by a choice, yes/no, rating or NPS answer of this version.',
        );
      }
      filter = { field, value };
    }

    const results = await versionResults(
      { raw: this.raw, cache: this.cache, ttlSeconds: this.config.resultsCacheTtlSeconds },
      version,
      filter,
    );
    return { ...results, versions: version.versions, definition: version.definition };
  }

  async responses(
    ownerId: string,
    formId: string,
    requested: number | undefined,
    cursor: string | undefined,
  ): Promise<ResponsesPage> {
    const version = await this.resolve(ownerId, formId, requested);
    const after = cursor === undefined ? null : decodeCursor(cursor);
    const size = this.config.responsesPageSize;

    // The total is the counter, not a count(*) over the version's rows.
    const total = version.versions.find((v) => v.id === version.id)?.responses ?? 0;
    const [rows] = await Promise.all([
      this.prisma.client.response.findMany({
        where: {
          formVersionId: version.id,
          submittedAt: { not: null },
          // Keyset, newest first: strictly before the cursor in (submitted_at, id) order.
          ...(after === null
            ? {}
            : {
                OR: [
                  { submittedAt: { lt: after.submittedAt } },
                  { submittedAt: after.submittedAt, id: { lt: after.id } },
                ],
              }),
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        take: size + 1,
        select: { id: true, submittedAt: true, answers: true },
      }),
    ]);

    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      version: version.version,
      total,
      rows: page.map((row) => ({
        id: row.id,
        submittedAt: row.submittedAt!.toISOString(),
        answers: row.answers as Record<string, AnswerValue>,
      })),
      next:
        rows.length > size && last !== undefined ? encodeCursor(last.submittedAt!, last.id) : null,
    };
  }

  /** The CSV as a stream of chunks, plus the file name. Pages by keyset, oldest first. */
  async export(
    ownerId: string,
    formId: string,
    requested: number | undefined,
  ): Promise<{ filename: string; chunks: AsyncGenerator<string> }> {
    const version = await this.resolve(ownerId, formId, requested);
    const prisma = this.prisma.client;

    async function* pages(): AsyncGenerator<ExportRow[]> {
      let after: { submittedAt: Date; id: string } | null = null;
      for (;;) {
        const rows: Array<{ id: string; submittedAt: Date | null; answers: unknown }> =
          await prisma.response.findMany({
            where: {
              formVersionId: version.id,
              submittedAt: { not: null },
              ...(after === null
                ? {}
                : {
                    OR: [
                      { submittedAt: { gt: after.submittedAt } },
                      { submittedAt: after.submittedAt, id: { gt: after.id } },
                    ],
                  }),
            },
            orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
            take: EXPORT_PAGE,
            select: { id: true, submittedAt: true, answers: true },
          });
        if (rows.length === 0) return;
        yield rows.map((row) => ({
          id: row.id,
          submittedAt: row.submittedAt!,
          answers: row.answers as Record<string, AnswerValue>,
        }));
        const last = rows.at(-1)!;
        after = { submittedAt: last.submittedAt!, id: last.id };
        if (rows.length < EXPORT_PAGE) return;
      }
    }

    return {
      filename: exportFilename(version.title, version.version),
      chunks: exportRows({ version: version.version, definition: version.definition }, pages()),
    };
  }
}
