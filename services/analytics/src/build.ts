/**
 * Counts in, the results contract out.
 *
 * `queries.ts` returns raw aggregates keyed by field id; this walks the
 * version's definition in form order and turns each answerable field's counts
 * into the result kind its type calls for (docs/DESIGN.md 3.2). Counts for keys
 * the definition does not have are ignored rather than reported: they can only
 * come from rows written against another definition, and per-version scoping
 * already rules that out.
 */
import type {
  Field,
  FieldResult,
  FieldResultBody,
  FormDefinition,
  FunnelStep,
} from '@forms/shared';
import { isAnswerable } from '@forms/shared';

import { histogram, mean, median, nps, type ValueCount } from './arithmetic';

export interface Aggregates {
  readonly totals: { started: number; completed: number };
  /** Completed responses by whole seconds from first save to submission. */
  readonly durations: readonly ValueCount[];
  /** Completed responses that answered each field. */
  readonly answered: ReadonlyArray<{ fieldId: string; count: number }>;
  /** Scalar answers grouped by value, completed responses only. */
  readonly scalar: ReadonlyArray<{ fieldId: string; value: unknown; count: number }>;
  /** Multi-choice selections grouped by option, completed responses only. */
  readonly multi: ReadonlyArray<{ fieldId: string; optionId: string; count: number }>;
  /** The latest text answers per field, newest first. */
  readonly latestText: ReadonlyArray<{ fieldId: string; value: string; submittedAt: Date }>;
  /** Responses whose path reached each field: all of them, and completed ones. */
  readonly reached: ReadonlyArray<{ fieldId: string; all: number; completed: number }>;
}

const TEXT_TYPES = new Set(['short_text', 'long_text', 'email']);

/** Which fields each query needs, so SQL never groups free text by value. */
export function fieldPlan(definition: FormDefinition): {
  scalar: string[];
  multi: string[];
  text: string[];
} {
  const scalar: string[] = [];
  const multi: string[] = [];
  const text: string[] = [];
  for (const field of definition.fields) {
    if (!isAnswerable(field)) continue;
    if (field.type === 'multi_choice') multi.push(field.id);
    else if (TEXT_TYPES.has(field.type)) text.push(field.id);
    else scalar.push(field.id);
  }
  return { scalar, multi, text };
}

function numericCounts(aggregates: Aggregates, fieldId: string): ValueCount[] {
  return aggregates.scalar
    .filter((row) => row.fieldId === fieldId && typeof row.value === 'number')
    .map((row) => ({ value: row.value as number, count: row.count }));
}

function distribution(counts: readonly ValueCount[], from: number, to: number): ValueCount[] {
  const byValue = new Map(counts.map((entry) => [entry.value, entry.count]));
  const out: ValueCount[] = [];
  for (let value = from; value <= to; value += 1)
    out.push({ value, count: byValue.get(value) ?? 0 });
  return out;
}

function resultFor(
  field: Exclude<Field, { type: 'statement' }>,
  aggregates: Aggregates,
): FieldResultBody {
  switch (field.type) {
    case 'single_choice': {
      const counts = new Map(
        aggregates.scalar
          .filter((row) => row.fieldId === field.id)
          .map((row) => [row.value, row.count]),
      );
      return {
        kind: 'choice',
        multiple: false,
        options: field.options.map((option) => ({
          optionId: option.id,
          label: option.label,
          count: counts.get(option.id) ?? 0,
        })),
      };
    }
    case 'multi_choice': {
      const counts = new Map(
        aggregates.multi
          .filter((row) => row.fieldId === field.id)
          .map((row) => [row.optionId, row.count]),
      );
      return {
        kind: 'choice',
        multiple: true,
        options: field.options.map((option) => ({
          optionId: option.id,
          label: option.label,
          count: counts.get(option.id) ?? 0,
        })),
      };
    }
    case 'rating': {
      const counts = numericCounts(aggregates, field.id);
      return {
        kind: 'scale',
        distribution: distribution(counts, 1, field.scale),
        mean: mean(counts),
      };
    }
    case 'nps': {
      const counts = numericCounts(aggregates, field.id);
      return { kind: 'nps', distribution: distribution(counts, 0, 10), ...nps(counts) };
    }
    case 'number': {
      const counts = numericCounts(aggregates, field.id);
      const values = counts.filter((entry) => entry.count > 0).map((entry) => entry.value);
      return {
        kind: 'number',
        min: values.length === 0 ? null : Math.min(...values),
        max: values.length === 0 ? null : Math.max(...values),
        mean: mean(counts),
        median: median(counts),
        bins: histogram(counts, {
          integer: field.integer,
          ...(field.min === undefined ? {} : { min: field.min }),
          ...(field.max === undefined ? {} : { max: field.max }),
        }),
      };
    }
    case 'yes_no': {
      const rows = aggregates.scalar.filter((row) => row.fieldId === field.id);
      const count = (value: boolean) => rows.find((row) => row.value === value)?.count ?? 0;
      return { kind: 'boolean', yes: count(true), no: count(false) };
    }
    case 'date': {
      const dates = aggregates.scalar
        .filter((row) => row.fieldId === field.id && typeof row.value === 'string')
        .map((row) => row.value as string)
        .sort();
      return { kind: 'date', earliest: dates[0] ?? null, latest: dates.at(-1) ?? null };
    }
    case 'short_text':
    case 'long_text':
    case 'email':
      return {
        kind: 'text',
        latest: aggregates.latestText
          .filter((row) => row.fieldId === field.id)
          .map((row) => ({ value: row.value, submittedAt: row.submittedAt.toISOString() })),
      };
  }
}

export function buildFieldResults(
  definition: FormDefinition,
  aggregates: Aggregates,
): FieldResult[] {
  const answered = new Map(aggregates.answered.map((row) => [row.fieldId, row.count]));
  const reached = new Map(aggregates.reached.map((row) => [row.fieldId, row.completed]));
  const out: FieldResult[] = [];
  for (const field of definition.fields) {
    if (field.type === 'statement') continue;
    out.push({
      fieldId: field.id,
      title: field.title,
      type: field.type,
      answered: answered.get(field.id) ?? 0,
      reached: reached.get(field.id) ?? 0,
      result: resultFor(field, aggregates),
    });
  }
  return out;
}

/** The funnel: every shown field in form order, with how many responses reached it. */
export function buildFunnel(definition: FormDefinition, aggregates: Aggregates): FunnelStep[] {
  const reached = new Map(aggregates.reached.map((row) => [row.fieldId, row.all]));
  return definition.fields.map((field) => ({
    fieldId: field.id,
    title: field.title,
    reached: reached.get(field.id) ?? 0,
  }));
}
