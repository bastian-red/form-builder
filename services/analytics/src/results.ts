/**
 * Results for one version (docs/SPECS.md 7).
 *
 * **Unfiltered: the counters.** O(distinct answers), whatever the response
 * count, and always current because they commit with the responses. No cache:
 * there is nothing slower behind them to protect.
 *
 * **Filtered: a scan, cached.** Counters cannot be sliced by an arbitrary
 * answer, so a filtered view aggregates the responses the GIN index selects.
 * Its cache key carries the version's response count and last update time, read
 * by one cheap indexed query first; any save changes the key, so a cached
 * payload can never be stale and nothing ever needs invalidating. The TTL is a
 * memory bound, not a freshness bound. A cache that is down is a slow page,
 * never a failed one.
 */
import type { AnswerValue, Field, FormDefinition, Results, ResultsFilter } from '@forms/shared';

import { median } from './arithmetic';
import { buildFieldResults, buildFunnel, fieldPlan, type Aggregates } from './build';
import { loadCounters } from './counters';
import { SQL, loadAggregates, type RawQuery } from './queries';

export interface ResultsCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface ResultsDeps {
  readonly raw: RawQuery;
  readonly cache: ResultsCache;
  readonly ttlSeconds: number;
  readonly now?: () => Date;
}

export type VersionResults = Omit<Results, 'versions' | 'definition'>;

/** The field types a results filter may be set on: the ones with a small set of values. */
export const FILTERABLE_TYPES = new Set([
  'single_choice',
  'multi_choice',
  'yes_no',
  'rating',
  'nps',
]);

/**
 * The filter's typed value from the query string's text, or null when the text
 * is not a value that field can hold. "true" is a boolean only for a yes/no
 * question; "3" is a number only for a rating or NPS.
 */
export function parseFilterValue(field: Field, text: string): AnswerValue | null {
  switch (field.type) {
    case 'single_choice':
    case 'multi_choice':
      return field.options.some((option) => option.id === text) ? text : null;
    case 'yes_no':
      return text === 'true' ? true : text === 'false' ? false : null;
    case 'rating':
    case 'nps': {
      if (!/^\d{1,2}$/u.test(text)) return null;
      const value = Number(text);
      const [low, high] = field.type === 'nps' ? [0, 10] : [1, field.scale];
      return value >= low && value <= high ? value : null;
    }
    default:
      return null;
  }
}

/**
 * The containment document for `answers @> $2`. A multi-choice filter is a
 * one-element array, which `@>` reads as "the selection includes this option".
 */
export function filterDocument(field: Field, value: AnswerValue): string {
  return JSON.stringify({ [field.id]: field.type === 'multi_choice' ? [value] : value });
}

function assemble(
  version: { id: string; version: number; definition: FormDefinition },
  aggregates: Aggregates,
  filter: ResultsFilter | null,
  now: Date,
): VersionResults {
  return {
    versionId: version.id,
    version: version.version,
    filter,
    totals: {
      started: aggregates.totals.started,
      completed: aggregates.totals.completed,
      medianSecondsToComplete: median(aggregates.durations),
    },
    funnel: buildFunnel(version.definition, aggregates),
    fields: buildFieldResults(version.definition, aggregates),
    generatedAt: now.toISOString(),
    cached: false,
  };
}

export async function versionResults(
  deps: ResultsDeps,
  version: { id: string; version: number; definition: FormDefinition },
  filter: { field: Field; value: AnswerValue } | null,
): Promise<VersionResults> {
  const now = (deps.now ?? (() => new Date()))();
  if (filter === null) {
    return assemble(
      version,
      await loadCounters(deps.raw, version.id, version.definition),
      null,
      now,
    );
  }

  const filterJson = filterDocument(filter.field, filter.value);
  const [fingerprint] = await deps.raw<{ n: number; last: Date | null }>(
    SQL.fingerprint,
    version.id,
  );
  const key = [
    'results:v1',
    version.id,
    filterJson,
    String(fingerprint?.n ?? 0),
    fingerprint?.last?.toISOString() ?? '-',
  ].join(':');

  try {
    const hit = await deps.cache.get(key);
    if (hit !== null) return { ...(JSON.parse(hit) as VersionResults), cached: true };
  } catch (error) {
    console.warn('[analytics] cache read failed, computing directly', error);
  }

  const aggregates = await loadAggregates(
    deps.raw,
    version.id,
    filterJson,
    fieldPlan(version.definition),
  );
  const results = assemble(
    version,
    aggregates,
    { fieldId: filter.field.id, value: filter.value },
    now,
  );
  try {
    await deps.cache.set(key, JSON.stringify(results), deps.ttlSeconds);
  } catch (error) {
    console.warn('[analytics] cache write failed', error);
  }
  return results;
}
