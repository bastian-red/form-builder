'use server';

/**
 * The respondent's one write. Anonymous: no session, no token. `apiFetch(null,
 * ...)` forwards the browser's address so the API's per-address budget is per
 * respondent rather than shared by everybody.
 *
 * Every outcome is a value, never a throw: a thrown server-action error reaches
 * the browser as an opaque digest, and a respondent whose answer was refused
 * needs to be taken back to the question with the sentence that says why.
 */
import {
  answerProblemSchema,
  responseIdSchema,
  saveResponseResultSchema,
  saveResponseSchema,
  type AnswerProblem,
  type SaveResponseInput,
} from '@forms/shared';
import { z } from 'zod';

import { ApiError, apiFetch } from '../../lib/api';

export type SaveResponseOutcome =
  | { readonly ok: true; readonly status: 'saved' | 'completed' }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly problems: AnswerProblem[];
    };

export async function saveResponseAction(
  responseId: string,
  input: SaveResponseInput,
): Promise<SaveResponseOutcome> {
  const id = responseIdSchema.safeParse(responseId);
  const body = saveResponseSchema.safeParse(input);
  if (!id.success || !body.success) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'These answers could not be sent. Reload the page and try again.',
      problems: [],
    };
  }
  try {
    const result = await apiFetch(null, `/public/responses/${id.data}`, saveResponseResultSchema, {
      method: 'PUT',
      body: body.data,
    });
    return { ok: true, status: result.status };
  } catch (error) {
    if (error instanceof ApiError) {
      const problems = z.array(answerProblemSchema).safeParse(error.details);
      return {
        ok: false,
        code: error.status === 429 ? 'RATE_LIMITED' : error.code,
        message:
          error.status === 429
            ? 'Too many answers from this connection at once. Wait a minute, then continue.'
            : error.message,
        problems: problems.success ? problems.data : [],
      };
    }
    console.error('[web] response save failed', error);
    return {
      ok: false,
      code: 'NETWORK',
      message: 'Your answers could not be sent. Check your connection and try again.',
      problems: [],
    };
  }
}
