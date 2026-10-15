/**
 * The author's forms: list, create, draft saves, publish, close, delete
 * (docs/SPECS.md 6).
 *
 * Ownership is checked in the WHERE clause of every query rather than read and
 * compared afterwards, so there is no window between "is it yours" and "change
 * it". Somebody else's form answers NOT_FOUND, never FORBIDDEN: an author
 * probing ids must not learn which ones exist.
 */
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { Injectable } from '@nestjs/common';
import { FORM_SLUG_UNIQUE, violatedUniqueIndex, VERSION_NUMBER_UNIQUE } from '@forms/db';
import { analyze, hasErrors } from '@forms/form-logic';
import {
  DomainError,
  emptyDefinition,
  formDefinitionSchema,
  type FormDefinition,
  type FormDetail,
  type FormSummary,
  type PublishResult,
  type SaveDraftInput,
} from '@forms/shared';

import { PrismaService } from '../infra/prisma.service';

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Ten random lowercase alphanumerics: 36^10 is 3.7e15, so a slug cannot be
 * guessed by walking the space, and a collision is retried rather than assumed
 * impossible. Rejection sampling below 252 keeps every character equally likely.
 */
export function newSlug(random: (size: number) => Buffer = randomBytes): string {
  let out = '';
  while (out.length < 10) {
    for (const byte of random(16)) {
      if (byte < 252) out += SLUG_ALPHABET[byte % 36];
      if (out.length === 10) break;
    }
  }
  return out;
}

/** A stored definition, parsed. A row that does not parse is a bug, so it throws. */
export function parseStored(value: unknown): FormDefinition {
  return formDefinitionSchema.parse(value);
}

@Injectable()
export class FormsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string): Promise<FormSummary[]> {
    const rows = await this.prisma.client.$queryRaw<
      Array<{
        id: string;
        slug: string;
        title: string;
        accepting: boolean;
        updated_at: Date;
        latest_version: number | null;
        responses: number;
        unpublished: boolean;
      }>
    >`
      SELECT f.id, f.slug, f.title, f.accepting, f.updated_at,
             latest.version AS latest_version,
             (SELECT coalesce(sum(s.completed), 0)::int
                FROM version_stats s JOIN form_versions v ON v.id = s.form_version_id
               WHERE v.form_id = f.id) AS responses,
             (latest.definition IS NULL OR latest.definition <> f.draft) AS unpublished
        FROM forms f
        LEFT JOIN LATERAL (
          SELECT v.version, v.definition FROM form_versions v
           WHERE v.form_id = f.id ORDER BY v.version DESC LIMIT 1
        ) latest ON true
       WHERE f.owner_id = ${ownerId}
       ORDER BY f.updated_at DESC`;
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      accepting: row.accepting,
      updatedAt: row.updated_at.toISOString(),
      latestVersion: row.latest_version,
      responses: row.responses,
      unpublishedChanges: row.unpublished,
    }));
  }

  async create(ownerId: string, title: string): Promise<{ id: string; slug: string }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.client.form.create({
          data: { ownerId, slug: newSlug(), title, draft: emptyDefinition(title) },
          select: { id: true, slug: true },
        });
      } catch (error) {
        // A slug collision at 36^10 means something is wrong with randomness,
        // but retrying is still the right answer to a unique violation on a
        // value we chose; anything else is not ours to handle.
        if (!violatedUniqueIndex(error, FORM_SLUG_UNIQUE)) throw error;
      }
    }
    throw new DomainError('CONFLICT', 'Could not allocate a link for the new form. Try again.');
  }

  async detail(ownerId: string, id: string): Promise<FormDetail> {
    const form = await this.prisma.client.form.findFirst({
      where: { id, ownerId },
      select: {
        id: true,
        slug: true,
        accepting: true,
        draft: true,
        draftRevision: true,
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
    const draft = parseStored(form.draft);
    const latest = form.versions.at(-1);

    return {
      id: form.id,
      slug: form.slug,
      accepting: form.accepting,
      draft,
      revision: form.draftRevision,
      versions: form.versions.map((version) => ({
        id: version.id,
        version: version.version,
        publishedAt: version.publishedAt.toISOString(),
        responses: version.stats?.completed ?? 0,
      })),
      unpublishedChanges:
        latest === undefined || !isDeepStrictEqual(parseStored(latest.definition), draft),
    };
  }

  /**
   * Save the draft if nobody saved since `revision`.
   *
   * One conditional UPDATE: `WHERE draft_revision = $revision` is the whole
   * concurrency control. Two tabs saving from the same revision both run it; the
   * second matches no row, and is answered 409 instead of silently erasing the
   * first tab's work.
   */
  async saveDraft(
    ownerId: string,
    id: string,
    input: SaveDraftInput,
  ): Promise<{ revision: number }> {
    const updated = await this.prisma.client.form.updateMany({
      where: { id, ownerId, draftRevision: input.revision },
      data: {
        draft: input.definition,
        title: input.definition.title,
        draftRevision: { increment: 1 },
      },
    });
    if (updated.count === 1) return { revision: input.revision + 1 };

    const exists = await this.prisma.client.form.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });
    if (exists === null) throw new DomainError('NOT_FOUND', 'No such form.');
    throw new DomainError(
      'CONFLICT',
      'This form was saved from somewhere else since you opened it. Reload to see the latest version.',
    );
  }

  /**
   * Cut a version from the draft.
   *
   * Inside one transaction that first locks the form row (`FOR UPDATE`), so two
   * publishes of one form serialize: the second sees the first's version and
   * either finds nothing new or takes the next number. The unique index on
   * `(form_id, version)` is the backstop if that ever stops being true.
   *
   * Idempotent: publishing a draft identical to the latest version cuts nothing
   * and answers `created: false`, so a double-click is not two versions.
   */
  async publish(ownerId: string, id: string): Promise<PublishResult> {
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ draft: unknown }>>`
          SELECT draft FROM forms WHERE id = ${id} AND owner_id = ${ownerId} FOR UPDATE`;
        const row = locked[0];
        if (row === undefined) throw new DomainError('NOT_FOUND', 'No such form.');

        const draft = parseStored(row.draft);
        const issues = analyze(draft);
        if (hasErrors(issues)) {
          throw new DomainError(
            'UNPROCESSABLE',
            'This form cannot be published until its problems are fixed.',
            issues.filter((issue) => issue.severity === 'error'),
          );
        }
        const warnings = issues.filter((issue) => issue.severity === 'warning');

        const latest = await tx.formVersion.findFirst({
          where: { formId: id },
          orderBy: { version: 'desc' },
          select: { id: true, version: true, definition: true },
        });
        if (latest !== null && isDeepStrictEqual(parseStored(latest.definition), draft)) {
          return { versionId: latest.id, version: latest.version, created: false, warnings };
        }

        const created = await tx.formVersion.create({
          data: { formId: id, version: (latest?.version ?? 0) + 1, definition: draft },
          select: { id: true, version: true },
        });
        return { versionId: created.id, version: created.version, created: true, warnings };
      });
    } catch (error) {
      if (violatedUniqueIndex(error, VERSION_NUMBER_UNIQUE)) {
        throw new DomainError(
          'CONFLICT',
          'This form was published from somewhere else at the same moment. Try again.',
        );
      }
      throw error;
    }
  }

  async setAccepting(ownerId: string, id: string, accepting: boolean): Promise<void> {
    const updated = await this.prisma.client.form.updateMany({
      where: { id, ownerId },
      data: { accepting },
    });
    if (updated.count === 0) throw new DomainError('NOT_FOUND', 'No such form.');
  }

  async remove(ownerId: string, id: string): Promise<void> {
    const deleted = await this.prisma.client.form.deleteMany({ where: { id, ownerId } });
    if (deleted.count === 0) throw new DomainError('NOT_FOUND', 'No such form.');
  }
}
