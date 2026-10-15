import { z } from 'zod';

import { fieldIdSchema, formDefinitionSchema } from '../form/definition';
import { idSchema, instantSchema, slugSchema, versionNumberSchema } from './primitives';

/**
 * The owner-side form contracts (docs/SPECS.md 6).
 */

export const formTitleSchema = z.string().trim().min(1).max(120);

export const createFormSchema = z.object({ title: formTitleSchema });

/**
 * A draft save. `revision` is the revision the browser last saw; the API refuses
 * the write with 409 if somebody (another tab) saved in between, rather than
 * letting the later write silently erase the earlier one.
 */
export const saveDraftSchema = z.object({
  definition: formDefinitionSchema,
  revision: z.number().int().nonnegative(),
});

export const saveDraftResultSchema = z.object({ revision: z.number().int().positive() });

export const updateFormSchema = z.object({ accepting: z.boolean() });

export const versionSummarySchema = z.object({
  id: idSchema,
  version: versionNumberSchema,
  publishedAt: instantSchema,
  responses: z.number().int().nonnegative(),
});

export const formSummarySchema = z.object({
  id: idSchema,
  slug: slugSchema,
  title: z.string(),
  accepting: z.boolean(),
  updatedAt: instantSchema,
  latestVersion: versionNumberSchema.nullable(),
  /** Completed responses across every version. */
  responses: z.number().int().nonnegative(),
  /** The draft differs from the latest published version. */
  unpublishedChanges: z.boolean(),
});

export const formListSchema = z.array(formSummarySchema);

export const formDetailSchema = z.object({
  id: idSchema,
  slug: slugSchema,
  accepting: z.boolean(),
  draft: formDefinitionSchema,
  revision: z.number().int().nonnegative(),
  versions: z.array(versionSummarySchema),
  unpublishedChanges: z.boolean(),
});

export const ISSUE_CODES = [
  'no_fields',
  'duplicate_id',
  'duplicate_option',
  'too_few_options',
  'invalid_bounds',
  'dangling_ref',
  'forward_ref',
  'backward_jump',
  'type_mismatch',
  'statement_condition',
  'unreachable',
] as const;

/**
 * One problem the analyzer found. `fieldId` is the block it is drawn on; `ref`
 * is the other end of the edge (the referenced field or the jump target), so the
 * builder can draw the broken connector between the two.
 */
export const analyzerIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.enum(ISSUE_CODES),
  fieldId: fieldIdSchema.nullable(),
  ref: z.string().nullable(),
  message: z.string(),
});

export const publishResultSchema = z.object({
  versionId: idSchema,
  version: versionNumberSchema,
  /** False when the draft equalled the latest version and nothing new was cut. */
  created: z.boolean(),
  warnings: z.array(analyzerIssueSchema),
});

/** The 422 body of a refused publish. */
export const publishRefusalSchema = z.object({
  code: z.literal('UNPROCESSABLE'),
  message: z.string(),
  details: z.array(analyzerIssueSchema),
});

export type CreateFormInput = z.infer<typeof createFormSchema>;
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
export type FormSummary = z.infer<typeof formSummarySchema>;
export type FormDetail = z.infer<typeof formDetailSchema>;
export type VersionSummary = z.infer<typeof versionSummarySchema>;
export type AnalyzerIssue = z.infer<typeof analyzerIssueSchema>;
export type IssueCode = (typeof ISSUE_CODES)[number];
export type PublishResult = z.infer<typeof publishResultSchema>;
