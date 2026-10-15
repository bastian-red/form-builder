import { z } from 'zod';

import {
  answerValueSchema,
  fieldIdSchema,
  formDefinitionSchema,
  optionIdSchema,
} from '../form/definition';
import { idSchema, instantSchema, responseIdSchema, versionNumberSchema } from './primitives';
import { versionSummarySchema } from './forms';

/**
 * What the results report renders (docs/SPECS.md 7, docs/DESIGN.md 6).
 *
 * Every number here is a COUNT or derived from counts by `services/analytics`;
 * nothing is a pre-formatted string, so the page decides how to say "37%" and
 * the table view prints the same numbers the chart draws.
 */

const count = z.number().int().nonnegative();

export const choiceResultSchema = z.object({
  kind: z.literal('choice'),
  multiple: z.boolean(),
  options: z.array(z.object({ optionId: optionIdSchema, label: z.string(), count })),
});

export const scaleResultSchema = z.object({
  kind: z.literal('scale'),
  /** 1..scale for rating. */
  distribution: z.array(z.object({ value: z.number().int(), count })),
  mean: z.number().nullable(),
});

export const npsResultSchema = z.object({
  kind: z.literal('nps'),
  distribution: z.array(z.object({ value: z.number().int(), count })),
  detractors: count,
  passives: count,
  promoters: count,
  /** -100..100, null with no answers. */
  score: z.number().int().min(-100).max(100).nullable(),
});

export const numberResultSchema = z.object({
  kind: z.literal('number'),
  min: z.number().nullable(),
  max: z.number().nullable(),
  mean: z.number().nullable(),
  median: z.number().nullable(),
  bins: z.array(z.object({ from: z.number(), to: z.number(), count })),
});

export const booleanResultSchema = z.object({ kind: z.literal('boolean'), yes: count, no: count });

export const textResultSchema = z.object({
  kind: z.literal('text'),
  latest: z.array(z.object({ value: z.string(), submittedAt: instantSchema })),
});

export const dateResultSchema = z.object({
  kind: z.literal('date'),
  earliest: z.string().nullable(),
  latest: z.string().nullable(),
});

export const fieldResultSchema = z.object({
  fieldId: fieldIdSchema,
  title: z.string(),
  type: z.string(),
  /** Completed responses that answered this field. */
  answered: count,
  /** Completed responses whose path showed this field. */
  reached: count,
  result: z.discriminatedUnion('kind', [
    choiceResultSchema,
    scaleResultSchema,
    npsResultSchema,
    numberResultSchema,
    booleanResultSchema,
    textResultSchema,
    dateResultSchema,
  ]),
});

export const funnelStepSchema = z.object({
  fieldId: fieldIdSchema,
  title: z.string(),
  /** Responses (started or completed) whose path reached this field. */
  reached: count,
});

export const resultsFilterSchema = z.object({
  fieldId: fieldIdSchema,
  value: answerValueSchema,
});

export const resultsSchema = z.object({
  versionId: idSchema,
  version: versionNumberSchema,
  versions: z.array(versionSummarySchema),
  /**
   * The definition of THIS version: what the report is about. The draft may
   * have moved on since, and a report labelled with the draft's questions would
   * describe answers to questions nobody was asked.
   */
  definition: formDefinitionSchema,
  filter: resultsFilterSchema.nullable(),
  totals: z.object({
    started: count,
    completed: count,
    /** Median seconds from first save to submission, null with no completions. */
    medianSecondsToComplete: z.number().nullable(),
  }),
  funnel: z.array(funnelStepSchema),
  fields: z.array(fieldResultSchema),
  generatedAt: instantSchema,
  cached: z.boolean(),
});

/**
 * The query string of `GET /forms/:id/results`. `filterValue` arrives as text;
 * the API reads the field's type from the version to know whether "3" means the
 * number 3, and an option id stays a string.
 */
export const resultsQuerySchema = z
  .object({
    version: z
      .string()
      .regex(/^\d{1,6}$/u)
      .transform(Number)
      .optional(),
    filterField: fieldIdSchema.optional(),
    filterValue: z.string().max(200).optional(),
  })
  .refine(
    (query) => (query.filterField === undefined) === (query.filterValue === undefined),
    'filterField and filterValue go together',
  );

export const responseRowSchema = z.object({
  id: responseIdSchema,
  submittedAt: instantSchema,
  answers: z.record(fieldIdSchema, answerValueSchema),
});

export const responsesPageSchema = z.object({
  version: versionNumberSchema,
  total: count,
  rows: z.array(responseRowSchema),
  /** Opaque keyset cursor for the next page, null on the last. */
  next: z.string().nullable(),
});

export const responsesQuerySchema = z.object({
  version: z
    .string()
    .regex(/^\d{1,6}$/u)
    .transform(Number)
    .optional(),
  cursor: z.string().max(200).optional(),
});

export type FieldResult = z.infer<typeof fieldResultSchema>;
export type FieldResultBody = FieldResult['result'];
export type FunnelStep = z.infer<typeof funnelStepSchema>;
export type Results = z.infer<typeof resultsSchema>;
export type ResultsFilter = z.infer<typeof resultsFilterSchema>;
export type ResultsQuery = z.infer<typeof resultsQuerySchema>;
export type ResponseRow = z.infer<typeof responseRowSchema>;
export type ResponsesPage = z.infer<typeof responsesPageSchema>;
