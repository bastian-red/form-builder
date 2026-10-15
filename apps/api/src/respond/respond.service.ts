/**
 * The respondent's side: read a public form, save answers (docs/SPECS.md 6).
 *
 * The browser's idea of the path is never trusted. Every save is normalized,
 * walked and validated here by the same `@forms/form-logic` the browser ran,
 * and the funnel's `reached` column is computed from that walk, not taken from
 * the request.
 *
 * Every write runs in one transaction with the results counters it changes
 * (`@forms/analytics` counters.ts), so the report and the responses commit or
 * roll back together. The response row is locked first, the counters after it
 * in key order, so two saves can queue but never deadlock.
 */
import { isDeepStrictEqual } from 'node:util';

import { Inject, Injectable } from '@nestjs/common';
import {
  COUNTER_SQL,
  applyDeltas,
  responseDeltas,
  type RawExecute,
  type RawQuery,
} from '@forms/analytics';
import { reachedPath, validateSubmission } from '@forms/form-logic';
import {
  DomainError,
  type FormDefinition,
  type PublicForm,
  type SaveResponseInput,
  type SaveResponseResult,
} from '@forms/shared';

import { API_CONFIG, type ApiConfig } from '../config/config';
import { parseStored } from '../forms/forms.service';
import { PrismaService } from '../infra/prisma.service';

/**
 * Parsed definitions by version id. A published version is immutable (a
 * database trigger refuses UPDATEs), so a parse is valid forever and a save
 * does not re-validate a 300 KB definition on every keystroke. Bounded, oldest
 * evicted first.
 */
export class DefinitionCache {
  private readonly entries = new Map<string, FormDefinition>();

  constructor(private readonly capacity = 500) {}

  get(versionId: string, load: () => FormDefinition): FormDefinition {
    const hit = this.entries.get(versionId);
    if (hit !== undefined) return hit;
    const parsed = load();
    if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(versionId, parsed);
    return parsed;
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Whole seconds from first save to now (or to submission), for the duration counter. */
const SECONDS = `floor(extract(epoch FROM coalesce(submitted_at, GREATEST(now(), started_at)) - started_at))::int AS seconds`;

interface LockedRow {
  readonly form_version_id: string;
  readonly reached: string[];
  readonly submitted: boolean;
  readonly answers: unknown;
}

/** The response row, locked for the rest of the transaction, or null. */
async function lockRow(raw: RawQuery, id: string): Promise<LockedRow | null> {
  const rows = await raw<LockedRow>(
    `SELECT form_version_id, reached, submitted_at IS NOT NULL AS submitted, answers
       FROM responses WHERE id = $1::uuid FOR UPDATE`,
    id,
  );
  return rows[0] ?? null;
}

@Injectable()
export class RespondService {
  private readonly definitions = new DefinitionCache();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async publicForm(slug: string): Promise<PublicForm> {
    const form = await this.prisma.client.form.findUnique({
      where: { slug },
      select: {
        accepting: true,
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true, version: true, definition: true },
        },
      },
    });
    const latest = form?.versions[0];
    // An unpublished form does not exist as far as a respondent can tell.
    if (form === null || latest === undefined)
      throw new DomainError('NOT_FOUND', 'There is no form at this link.');
    if (!form.accepting)
      throw new DomainError('GONE', 'This form is no longer accepting responses.');
    return {
      slug,
      versionId: latest.id,
      version: latest.version,
      definition: this.definitions.get(latest.id, () => parseStored(latest.definition)),
    };
  }

  async save(responseId: string, input: SaveResponseInput): Promise<SaveResponseResult> {
    if (Buffer.byteLength(JSON.stringify(input.answers)) > this.config.maxAnswersBytes) {
      throw new DomainError('TOO_LARGE', 'These answers are too long to save.');
    }

    const version = await this.prisma.client.formVersion.findUnique({
      where: { id: input.formVersionId },
      select: { id: true, formId: true, definition: true, form: { select: { accepting: true } } },
    });
    if (version === null) throw new DomainError('NOT_FOUND', 'There is no form at this link.');
    if (!version.form.accepting)
      throw new DomainError('GONE', 'This form is no longer accepting responses.');

    // The honeypot. Answered exactly like a real submission so a bot learns
    // nothing, and stored nowhere. The log line is the evidence it fires.
    if (input.website !== undefined && input.website.trim() !== '') {
      console.warn(`[api] honeypot filled on form ${version.formId}; response dropped`);
      return { status: input.complete ? 'completed' : 'saved' };
    }

    const definition = this.definitions.get(version.id, () => parseStored(version.definition));
    const verdict = validateSubmission(definition, input.answers, { complete: input.complete });
    if (!verdict.ok) {
      throw new DomainError('UNPROCESSABLE', 'Some answers need attention.', verdict.problems);
    }
    const reached = input.complete ? verdict.path : reachedPath(verdict.path, input.currentFieldId);
    if (reached === null) {
      throw new DomainError(
        'INVALID',
        'The current question is not on the path these answers lead to.',
      );
    }

    const toStore = JSON.stringify(verdict.answers);
    return this.prisma.client.$transaction(async (tx) => {
      const raw = ((sql: string, ...params: unknown[]) =>
        tx.$queryRawUnsafe(sql, ...params)) as RawQuery;
      const execute: RawExecute = (sql, ...params) => tx.$executeRawUnsafe(sql, ...params);

      // Shared with every other save of this version, exclusive with `recount`:
      // a rebuild never interleaves with a save it would then double-count.
      await raw(COUNTER_SQL.lockShared, version.id);

      let existing = await lockRow(raw, responseId);
      if (existing === null) {
        // ON CONFLICT DO NOTHING, not DO UPDATE: of twenty concurrent first saves
        // exactly one inserts; the others wait for it to commit, insert nothing,
        // and fall through to the locked-update path below as ordinary repeats.
        const inserted = await raw<{ seconds: number }>(
          `INSERT INTO responses (id, form_id, form_version_id, answers, reached, started_at, updated_at, submitted_at)
           VALUES ($1::uuid, $2, $3, $4::jsonb, $5::text[], now(), now(), CASE WHEN $6 THEN now() ELSE NULL END)
           ON CONFLICT (id) DO NOTHING
           RETURNING ${SECONDS}`,
          responseId,
          version.formId,
          version.id,
          toStore,
          reached,
          input.complete,
        );
        if (inserted.length === 1) {
          const deltas = responseDeltas(definition, null, {
            reached,
            answers: verdict.answers,
            complete: input.complete,
            seconds: inserted[0]!.seconds,
          });
          await applyDeltas(execute, version.id, deltas);
          return { status: input.complete ? 'completed' : 'saved' } as const;
        }
        existing = await lockRow(raw, responseId);
        if (existing === null)
          throw new Error(`response ${responseId} conflicted on insert and then did not exist`);
      }

      if (existing.form_version_id !== version.id) {
        throw new DomainError(
          'CONFLICT',
          'This response belongs to an earlier version of the form.',
        );
      }
      if (existing.submitted) {
        // Final. A repeat of the identical final submission is the one benign
        // case (a retry whose first reply was lost), so it answers as it did.
        if (input.complete && isDeepStrictEqual(existing.answers, verdict.answers))
          return { status: 'completed' } as const;
        throw new DomainError('CONFLICT', 'This response was already submitted.');
      }

      // GREATEST(now(), started_at), not now(). `now()` is when THIS transaction
      // began, and a save that began before the one that inserted the row, then
      // waited on its lock, would stamp a time earlier than the row's own
      // started_at. The CHECK `responses_updated_after_started` refused exactly
      // that under twenty concurrent saves; the clock never runs backwards for
      // one response now.
      const updated = await raw<{ seconds: number }>(
        `UPDATE responses
            SET answers = $2::jsonb, reached = $3::text[], updated_at = GREATEST(now(), started_at),
                submitted_at = CASE WHEN $4 THEN GREATEST(now(), started_at) ELSE NULL END
          WHERE id = $1::uuid
          RETURNING ${SECONDS}`,
        responseId,
        toStore,
        reached,
        input.complete,
      );
      const deltas = responseDeltas(
        definition,
        { reached: existing.reached },
        {
          reached,
          answers: verdict.answers,
          complete: input.complete,
          seconds: updated[0]!.seconds,
        },
      );
      await applyDeltas(execute, version.id, deltas);
      return { status: input.complete ? 'completed' : 'saved' } as const;
    });
  }
}
