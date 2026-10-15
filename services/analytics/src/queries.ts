/**
 * The aggregation SQL (docs/SPECS.md 7).
 *
 * Every query is scoped by `form_version_id`, so a response is only ever
 * counted against the definition it was answered on, and every query takes the
 * same optional filter: `answers @> $2::jsonb`, which the GIN index on
 * `answers` (jsonb_path_ops) serves when it is selective.
 *
 * **This service takes a port, not a client.** `RawQuery` is "run this
 * parameterised SQL and give me rows", which the API implements with Prisma's
 * `$queryRawUnsafe`. The SQL strings are constants in this file and every value
 * is a positional parameter, so nothing a person typed is ever concatenated into
 * a statement. Keeping Prisma out means this package has no generated client to
 * build before its tests run.
 *
 * These are the SCAN path: the source of truth that `recount` rebuilds the
 * counters from, and the path a FILTERED results view takes (counters cannot be
 * sliced by an arbitrary answer). An unfiltered view reads the counters.
 *
 * Free text is never grouped by value: a long-text field over 100,000 responses
 * would be 100,000 groups. Text gets the latest ten per field instead, through a
 * LATERAL subquery that walks the `(form_version_id, submitted_at)` index
 * backwards and stops at ten.
 */
import type { Aggregates } from './build';

export type RawQuery = <Row>(sql: string, ...params: unknown[]) => Promise<Row[]>;

/** `$1` version, `$2` filter (jsonb or null). Appended to every WHERE. */
const SCOPE = `r.form_version_id = $1 AND ($2::jsonb IS NULL OR r.answers @> $2::jsonb)`;
const COMPLETED = `${SCOPE} AND r.submitted_at IS NOT NULL`;

export const SQL = Object.freeze({
  totals: `
    SELECT count(*)::int AS started, count(r.submitted_at)::int AS completed
      FROM responses r
     WHERE ${SCOPE}`,

  /**
   * Whole seconds, grouped, rather than percentile_cont over the raw interval:
   * the counters can only store whole-second buckets, and the median must be
   * the same number whichever path computed it.
   */
  durations: `
    SELECT floor(extract(epoch FROM r.submitted_at - r.started_at))::int AS seconds, count(*)::int AS count
      FROM responses r
     WHERE ${COMPLETED}
     GROUP BY 1`,

  answered: `
    SELECT k AS field_id, count(*)::int AS count
      FROM responses r, jsonb_object_keys(r.answers) k
     WHERE ${COMPLETED}
     GROUP BY k`,

  scalar: `
    SELECT e.key AS field_id, e.value AS value, count(*)::int AS count
      FROM responses r, jsonb_each(r.answers) e
     WHERE ${COMPLETED} AND e.key = ANY($3::text[])
     GROUP BY e.key, e.value`,

  multi: `
    SELECT e.key AS field_id, o AS option_id, count(*)::int AS count
      FROM responses r, jsonb_each(r.answers) e, jsonb_array_elements_text(e.value) o
     WHERE ${COMPLETED} AND e.key = ANY($3::text[]) AND jsonb_typeof(e.value) = 'array'
     GROUP BY e.key, o`,

  latestText: `
    SELECT k AS field_id, t.value, t.submitted_at
      FROM unnest($3::text[]) k
     CROSS JOIN LATERAL (
       SELECT r.answers ->> k AS value, r.submitted_at
         FROM responses r
        WHERE ${COMPLETED} AND r.answers ? k
        ORDER BY r.submitted_at DESC, r.id DESC
        LIMIT 10
     ) t
     ORDER BY k, t.submitted_at DESC`,

  reached: `
    SELECT k AS field_id,
           count(*)::int AS reached_all,
           (count(*) FILTER (WHERE r.submitted_at IS NOT NULL))::int AS reached_completed
      FROM responses r, unnest(r.reached) k
     WHERE ${SCOPE}
     GROUP BY k`,

  /**
   * The cache key's moving part: how many responses this version has and when
   * the last one changed. Any save changes one of the two, so a cached payload
   * is never served after the data moved, and nothing needs invalidating.
   */
  fingerprint: `
    SELECT count(*)::int AS n, max(r.updated_at) AS last
      FROM responses r
     WHERE r.form_version_id = $1`,
});

export async function loadAggregates(
  raw: RawQuery,
  versionId: string,
  filter: string | null,
  plan: { scalar: string[]; multi: string[]; text: string[] },
): Promise<Aggregates> {
  const [totals, durations, answered, scalar, multi, latestText, reached] = await Promise.all([
    raw<{ started: number; completed: number }>(SQL.totals, versionId, filter),
    raw<{ seconds: number; count: number }>(SQL.durations, versionId, filter),
    raw<{ field_id: string; count: number }>(SQL.answered, versionId, filter),
    plan.scalar.length === 0
      ? Promise.resolve([])
      : raw<{ field_id: string; value: unknown; count: number }>(
          SQL.scalar,
          versionId,
          filter,
          plan.scalar,
        ),
    plan.multi.length === 0
      ? Promise.resolve([])
      : raw<{ field_id: string; option_id: string; count: number }>(
          SQL.multi,
          versionId,
          filter,
          plan.multi,
        ),
    plan.text.length === 0
      ? Promise.resolve([])
      : raw<{ field_id: string; value: string; submitted_at: Date }>(
          SQL.latestText,
          versionId,
          filter,
          plan.text,
        ),
    raw<{ field_id: string; reached_all: number; reached_completed: number }>(
      SQL.reached,
      versionId,
      filter,
    ),
  ]);

  const head = totals[0];
  return {
    totals: { started: head?.started ?? 0, completed: head?.completed ?? 0 },
    durations: durations.map((row) => ({ value: row.seconds, count: row.count })),
    answered: answered.map((row) => ({ fieldId: row.field_id, count: row.count })),
    scalar: scalar.map((row) => ({ fieldId: row.field_id, value: row.value, count: row.count })),
    multi: multi.map((row) => ({
      fieldId: row.field_id,
      optionId: row.option_id,
      count: row.count,
    })),
    latestText: latestText.map((row) => ({
      fieldId: row.field_id,
      value: row.value,
      submittedAt: row.submitted_at,
    })),
    reached: reached.map((row) => ({
      fieldId: row.field_id,
      all: row.reached_all,
      completed: row.reached_completed,
    })),
  };
}
