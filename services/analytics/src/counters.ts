/**
 * Results counters: maintained per save, rebuildable from a scan
 * (docs/SPECS.md 7).
 *
 * Three pieces, and the third is what makes the first two trustworthy:
 *
 * 1. `responseDeltas` -- pure. Given a response's previous state and its new
 *    one, the change to every counter. The API applies it in the same
 *    transaction as the response write, so a counter and the row it counts
 *    commit or roll back together.
 * 2. `applyDeltas` / `loadCounters` -- the SQL that adds a delta and reads the
 *    totals back as `Aggregates`, the same shape the scan produces, so
 *    `build.ts` cannot tell which one it was handed.
 * 3. `recount` -- rebuild a version's counters from the responses themselves,
 *    under an exclusive advisory lock that every save takes in shared mode. Used
 *    by the seed, by `pnpm db:recount` as a repair tool, and by the integration
 *    lane, which asserts that after concurrent traffic the incremental counters
 *    equal a fresh recount. That assertion is the evidence they do not drift.
 *
 * Counted, for COMPLETED responses only: answered per field, reached per field,
 * each categorical value (multi-choice once per option), and the duration in
 * whole seconds. Counted for every response: started, and reached per field for
 * the funnel, which is the one counter that can go DOWN (a respondent goes Back
 * and takes another branch, and a field leaves their path).
 */
import type { AnswerValue, Answers, FieldId, FormDefinition } from '@forms/shared';
import { isAnswerable } from '@forms/shared';

import type { Aggregates } from './build';
import { fieldPlan } from './build';
import { SQL, loadAggregates, type RawQuery } from './queries';

export interface StatsRows {
  readonly started: number;
  readonly completed: number;
  readonly fields: ReadonlyArray<{
    fieldId: string;
    reachedAll: number;
    reachedCompleted: number;
    answered: number;
  }>;
  readonly answers: ReadonlyArray<{ fieldId: string; value: unknown; count: number }>;
  readonly durations: ReadonlyArray<{ seconds: number; count: number }>;
}

export const EMPTY_STATS: StatsRows = {
  started: 0,
  completed: 0,
  fields: [],
  answers: [],
  durations: [],
};

/** Field types whose values are counted. Text is too varied to count by value. */
const COUNTED_TYPES = new Set([
  'single_choice',
  'multi_choice',
  'rating',
  'nps',
  'number',
  'date',
  'yes_no',
]);

/** One categorical counter key, so equal values add up whatever object they arrived in. */
function valueKey(fieldId: string, value: unknown): string {
  return `${fieldId}\u0000${JSON.stringify(value)}`;
}

/**
 * The change to every counter when a response moves from `previous` (null for a
 * response not yet stored) to `next`. Never called for a response that was
 * already submitted: submitted responses are final, so they never move.
 */
export function responseDeltas(
  definition: FormDefinition,
  previous: { readonly reached: readonly FieldId[] } | null,
  next: {
    readonly reached: readonly FieldId[];
    readonly answers: Answers;
    readonly complete: boolean;
    readonly seconds: number;
  },
): StatsRows {
  const fields = new Map<
    string,
    { reachedAll: number; reachedCompleted: number; answered: number }
  >();
  const field = (id: string) => {
    let entry = fields.get(id);
    if (entry === undefined) {
      entry = { reachedAll: 0, reachedCompleted: 0, answered: 0 };
      fields.set(id, entry);
    }
    return entry;
  };

  const before = new Set(previous?.reached ?? []);
  const after = new Set(next.reached);
  for (const id of after) if (!before.has(id)) field(id).reachedAll += 1;
  for (const id of before) if (!after.has(id)) field(id).reachedAll -= 1;

  const answers = new Map<string, { fieldId: string; value: unknown; count: number }>();
  const durations: Array<{ seconds: number; count: number }> = [];
  if (next.complete) {
    for (const id of next.reached) field(id).reachedCompleted += 1;
    for (const definitionField of definition.fields) {
      if (!isAnswerable(definitionField)) continue;
      const value: AnswerValue | undefined = next.answers[definitionField.id];
      if (value === undefined) continue;
      field(definitionField.id).answered += 1;
      if (!COUNTED_TYPES.has(definitionField.type)) continue;
      const values =
        definitionField.type === 'multi_choice' && Array.isArray(value) ? value : [value];
      for (const item of values) {
        const key = valueKey(definitionField.id, item);
        const entry = answers.get(key) ?? { fieldId: definitionField.id, value: item, count: 0 };
        entry.count += 1;
        answers.set(key, entry);
      }
    }
    durations.push({ seconds: Math.max(0, Math.floor(next.seconds)), count: 1 });
  }

  return {
    started: previous === null ? 1 : 0,
    completed: next.complete ? 1 : 0,
    fields: [...fields.entries()]
      .filter(
        ([, delta]) =>
          delta.reachedAll !== 0 || delta.reachedCompleted !== 0 || delta.answered !== 0,
      )
      .map(([fieldId, delta]) => ({ fieldId, ...delta })),
    answers: [...answers.values()],
    durations,
  };
}

/** The port for writes; `RawQuery` is the read side. Both run inside the caller's transaction. */
export type RawExecute = (sql: string, ...params: unknown[]) => Promise<number>;

/**
 * Rows are written in a fixed order (by key) on purpose. Two saves on one
 * version touch overlapping counter rows; if each locked them in its own order
 * they could deadlock. Sorted, they queue behind each other instead.
 */
export const COUNTER_SQL = Object.freeze({
  /**
   * Update first, insert only if nothing was there. Not a plain upsert: Postgres
   * checks a CHECK against the row an INSERT PROPOSES before ON CONFLICT turns
   * it into an update, so completing an existing response -- delta (started 0,
   * completed 1) -- would fail `completed <= started` against a row that has
   * started = 320. Found by the E2E lane, which completed a response after a
   * partial save; the integration lane now does too. The insert branch only runs
   * for a version's first response, whose delta always has started = 1, and its
   * ON CONFLICT covers two first responses racing.
   */
  version: `
    WITH updated AS (
      UPDATE version_stats
         SET started = started + $2, completed = completed + $3
       WHERE form_version_id = $1
      RETURNING 1
    )
    INSERT INTO version_stats (form_version_id, started, completed)
    SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM updated)
    ON CONFLICT (form_version_id) DO UPDATE
       SET started = version_stats.started + EXCLUDED.started,
           completed = version_stats.completed + EXCLUDED.completed`,
  fields: `
    INSERT INTO field_stats (form_version_id, field_id, reached_all, reached_completed, answered)
    SELECT $1, t.f, t.a, t.c, t.n
      FROM unnest($2::text[], $3::int[], $4::int[], $5::int[]) AS t(f, a, c, n)
     ORDER BY t.f
    ON CONFLICT (form_version_id, field_id) DO UPDATE
       SET reached_all = field_stats.reached_all + EXCLUDED.reached_all,
           reached_completed = field_stats.reached_completed + EXCLUDED.reached_completed,
           answered = field_stats.answered + EXCLUDED.answered`,
  /**
   * Decrements are an UPDATE, never part of the upsert above. Postgres checks a
   * CHECK constraint against the row an INSERT PROPOSES, before ON CONFLICT
   * decides it is an update -- so `INSERT ... VALUES (-1)` fails the
   * non-negative check even when the existing row is 5. Found by that check in
   * the integration lane. A decrement only ever applies to a field an earlier
   * save of the same response counted, so the row always exists.
   */
  fieldDecrements: `
    UPDATE field_stats s SET reached_all = s.reached_all + t.a
      FROM (SELECT * FROM unnest($2::text[], $3::int[]) AS u(f, a) ORDER BY u.f) t
     WHERE s.form_version_id = $1 AND s.field_id = t.f`,
  answers: `
    INSERT INTO answer_stats (form_version_id, field_id, value, count)
    SELECT $1, t.f, t.v, t.n
      FROM unnest($2::text[], $3::jsonb[], $4::int[]) AS t(f, v, n)
     ORDER BY t.f, t.v::text
    ON CONFLICT (form_version_id, field_id, value) DO UPDATE
       SET count = answer_stats.count + EXCLUDED.count`,
  durations: `
    INSERT INTO duration_stats (form_version_id, seconds, count)
    SELECT $1, t.s, t.n FROM unnest($2::int[], $3::int[]) AS t(s, n) ORDER BY t.s
    ON CONFLICT (form_version_id, seconds) DO UPDATE
       SET count = duration_stats.count + EXCLUDED.count`,
  /** Taken SHARED by every save and EXCLUSIVE by recount, for this version only. */
  // `SELECT 1 FROM f()`, not `SELECT f()`: the lock functions return void, which
  // Prisma refuses to deserialize ("Failed to deserialize column of type void").
  lockShared: `SELECT 1 AS locked FROM pg_advisory_xact_lock_shared(hashtextextended($1, 0))`,
  lockExclusive: `SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1, 0))`,
  clear: [
    `DELETE FROM field_stats WHERE form_version_id = $1`,
    `DELETE FROM answer_stats WHERE form_version_id = $1`,
    `DELETE FROM duration_stats WHERE form_version_id = $1`,
    `DELETE FROM version_stats WHERE form_version_id = $1`,
  ],
  readVersion: `SELECT started, completed FROM version_stats WHERE form_version_id = $1`,
  readFields: `SELECT field_id, reached_all, reached_completed, answered FROM field_stats WHERE form_version_id = $1`,
  readAnswers: `SELECT field_id, value, count FROM answer_stats WHERE form_version_id = $1 AND count > 0`,
  readDurations: `SELECT seconds, count FROM duration_stats WHERE form_version_id = $1 AND count > 0`,
});

export async function applyDeltas(
  execute: RawExecute,
  versionId: string,
  deltas: StatsRows,
): Promise<void> {
  if (deltas.started !== 0 || deltas.completed !== 0) {
    await execute(COUNTER_SQL.version, versionId, deltas.started, deltas.completed);
  }
  // A field's delta is all non-negative, or a lone negative `reachedAll` (a
  // field that left the path); `responseDeltas` never mixes the two, because
  // completion counters only grow for fields ON the final path.
  const increments = deltas.fields.filter((row) => row.reachedAll >= 0);
  const decrements = deltas.fields.filter((row) => row.reachedAll < 0);
  if (increments.length > 0) {
    await execute(
      COUNTER_SQL.fields,
      versionId,
      increments.map((row) => row.fieldId),
      increments.map((row) => row.reachedAll),
      increments.map((row) => row.reachedCompleted),
      increments.map((row) => row.answered),
    );
  }
  if (decrements.length > 0) {
    await execute(
      COUNTER_SQL.fieldDecrements,
      versionId,
      decrements.map((row) => row.fieldId),
      decrements.map((row) => row.reachedAll),
    );
  }
  if (deltas.answers.length > 0) {
    await execute(
      COUNTER_SQL.answers,
      versionId,
      deltas.answers.map((row) => row.fieldId),
      deltas.answers.map((row) => JSON.stringify(row.value)),
      deltas.answers.map((row) => row.count),
    );
  }
  if (deltas.durations.length > 0) {
    await execute(
      COUNTER_SQL.durations,
      versionId,
      deltas.durations.map((row) => row.seconds),
      deltas.durations.map((row) => row.count),
    );
  }
}

/** The counters as `Aggregates`; text answers still come from the indexed LATERAL query. */
export async function loadCounters(
  raw: RawQuery,
  versionId: string,
  definition: FormDefinition,
): Promise<Aggregates> {
  const plan = fieldPlan(definition);
  const multi = new Set(plan.multi);
  const [version, fields, answers, durations] = await Promise.all([
    raw<{ started: number; completed: number }>(COUNTER_SQL.readVersion, versionId),
    raw<{ field_id: string; reached_all: number; reached_completed: number; answered: number }>(
      COUNTER_SQL.readFields,
      versionId,
    ),
    raw<{ field_id: string; value: unknown; count: number }>(COUNTER_SQL.readAnswers, versionId),
    raw<{ seconds: number; count: number }>(COUNTER_SQL.readDurations, versionId),
  ]);
  // The "latest ten" walk stops after ten matches, so it is cheap for a field
  // people answer and a full scan for one nobody does. The counter says which
  // is which, so a text field with no answers is never walked at all.
  const answeredText = new Set(fields.filter((row) => row.answered > 0).map((row) => row.field_id));
  const textToRead = plan.text.filter((id) => answeredText.has(id));
  const latestText =
    textToRead.length === 0
      ? []
      : await raw<{ field_id: string; value: string; submitted_at: Date }>(
          SQL.latestText,
          versionId,
          null,
          textToRead,
        );
  return {
    totals: { started: version[0]?.started ?? 0, completed: version[0]?.completed ?? 0 },
    durations: durations.map((row) => ({ value: row.seconds, count: row.count })),
    answered: fields
      .filter((row) => row.answered > 0)
      .map((row) => ({ fieldId: row.field_id, count: row.answered })),
    scalar: answers
      .filter((row) => !multi.has(row.field_id))
      .map((row) => ({ fieldId: row.field_id, value: row.value, count: row.count })),
    multi: answers
      .filter((row) => multi.has(row.field_id) && typeof row.value === 'string')
      .map((row) => ({ fieldId: row.field_id, optionId: row.value as string, count: row.count })),
    latestText: latestText.map((row) => ({
      fieldId: row.field_id,
      value: row.value,
      submittedAt: row.submitted_at,
    })),
    reached: fields.map((row) => ({
      fieldId: row.field_id,
      all: row.reached_all,
      completed: row.reached_completed,
    })),
  };
}

/** Counters equivalent to `aggregates` (a full, unfiltered scan). */
export function statsFromAggregates(aggregates: Aggregates): StatsRows {
  const fields = new Map<
    string,
    { reachedAll: number; reachedCompleted: number; answered: number }
  >();
  const entry = (id: string) => {
    let row = fields.get(id);
    if (row === undefined) {
      row = { reachedAll: 0, reachedCompleted: 0, answered: 0 };
      fields.set(id, row);
    }
    return row;
  };
  for (const row of aggregates.reached) {
    entry(row.fieldId).reachedAll = row.all;
    entry(row.fieldId).reachedCompleted = row.completed;
  }
  for (const row of aggregates.answered) entry(row.fieldId).answered = row.count;
  return {
    started: aggregates.totals.started,
    completed: aggregates.totals.completed,
    fields: [...fields.entries()].map(([fieldId, row]) => ({ fieldId, ...row })),
    answers: [
      ...aggregates.scalar.map((row) => ({
        fieldId: row.fieldId,
        value: row.value,
        count: row.count,
      })),
      ...aggregates.multi.map((row) => ({
        fieldId: row.fieldId,
        value: row.optionId as unknown,
        count: row.count,
      })),
    ],
    durations: aggregates.durations.map((row) => ({ seconds: row.value, count: row.count })),
  };
}

/**
 * Rebuild one version's counters from its responses. The caller runs this inside
 * a transaction; the exclusive advisory lock makes every concurrent save wait
 * until the rebuilt counters commit, so no save is counted twice or lost.
 */
export async function recount(
  raw: RawQuery,
  execute: RawExecute,
  versionId: string,
  definition: FormDefinition,
): Promise<StatsRows> {
  await raw(COUNTER_SQL.lockExclusive, versionId);
  for (const statement of COUNTER_SQL.clear) await execute(statement, versionId);
  const stats = statsFromAggregates(
    await loadAggregates(raw, versionId, null, fieldPlan(definition)),
  );
  await applyDeltas(execute, versionId, stats);
  return stats;
}
