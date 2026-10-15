import { z } from 'zod';

import { answersSchema, fieldIdSchema, formDefinitionSchema } from '../form/definition';
import { idSchema, slugSchema, versionNumberSchema } from './primitives';

/**
 * The respondent-side contracts: no account, one link.
 */

export const publicFormSchema = z.object({
  slug: slugSchema,
  versionId: idSchema,
  version: versionNumberSchema,
  definition: formDefinitionSchema,
});

/**
 * One save. Sent after every answered question (`complete: false`) and once at
 * the end (`complete: true`), always with the WHOLE answer set so far, so a
 * lost request is repaired by the next one and order does not matter.
 *
 * `currentFieldId` is where the respondent is. The server does not store it as
 * given: it walks the logic over the answers and records the path up to that
 * field as `reached`, which is what the funnel counts. A client cannot claim to
 * have reached a question its own answers route around.
 *
 * `website` is the honeypot: a field no person sees (it is off-screen and
 * `aria-hidden`), named the way a form-filling bot looks for. A save that fills
 * it is answered as accepted and stored nowhere.
 */
export const saveResponseSchema = z.object({
  formVersionId: idSchema,
  answers: answersSchema,
  currentFieldId: fieldIdSchema.nullable(),
  complete: z.boolean(),
  website: z.string().max(500).optional(),
});

export const saveResponseResultSchema = z.object({
  status: z.enum(['saved', 'completed']),
});

/** A refused submission: each problem names its field so the form can jump back to it. */
export const answerProblemSchema = z.object({
  fieldId: fieldIdSchema.nullable(),
  code: z.enum(['unknown_field', 'hidden_answered', 'required', 'invalid']),
  message: z.string(),
});

export type PublicForm = z.infer<typeof publicFormSchema>;
export type SaveResponseInput = z.infer<typeof saveResponseSchema>;
export type SaveResponseResult = z.infer<typeof saveResponseResultSchema>;
export type AnswerProblem = z.infer<typeof answerProblemSchema>;
