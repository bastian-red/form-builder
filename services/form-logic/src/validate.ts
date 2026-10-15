/**
 * Submission validation: what the API runs on every save (docs/SPECS.md 2.1).
 *
 * The server never trusts the browser's idea of the path. It normalizes the
 * answers, walks the logic itself, and refuses:
 *
 * - `unknown_field`   a key that is not a field of this version;
 * - `invalid`         a value the field does not accept, or an answer to a
 *                     statement;
 * - `hidden_answered` an answer to a field that is not on the path those same
 *                     answers produce. This is the check that makes branching
 *                     a rule instead of a suggestion: without it a scripted
 *                     client could answer the manager-only questions as a
 *                     student and the results would quietly include them;
 * - `required`        on a FINAL save only, a required field on the path with no
 *                     answer. A partial save is a respondent mid-way, and the
 *                     question after the one they are on is not missing yet.
 */
import type { AnswerProblem, AnswerValue, Answers, FieldId, FormDefinition } from '@forms/shared';

import { answerProblem, isAnswered, normalizeAnswers, requiredMessage } from './answers';
import { walk } from './walk';

export interface Validation {
  readonly ok: boolean;
  /** The normalized answers: trimmed, empties dropped. What gets stored. */
  readonly answers: Answers;
  /** The path the normalized answers produce. */
  readonly path: FieldId[];
  readonly problems: AnswerProblem[];
}

export function validateSubmission(
  definition: FormDefinition,
  raw: Answers,
  options: { readonly complete: boolean },
): Validation {
  const answers = normalizeAnswers(raw);
  const fields = new Map(definition.fields.map((field) => [field.id, field] as const));
  const problems: AnswerProblem[] = [];

  // Unknown keys are dropped from the walk rather than fed to it, so one bad
  // key produces one problem instead of a second, confusing one downstream.
  const known: Answers = {};
  for (const [id, value] of Object.entries(answers) as Array<[FieldId, AnswerValue]>) {
    if (fields.has(id)) known[id] = value;
    else
      problems.push({
        fieldId: id,
        code: 'unknown_field',
        message: 'This form has no such question.',
      });
  }

  const path = walk(definition, known);
  const onPath = new Set(path);

  for (const [id, value] of Object.entries(known) as Array<[FieldId, AnswerValue]>) {
    const field = fields.get(id)!;
    if (!onPath.has(id)) {
      problems.push({
        fieldId: id,
        code: 'hidden_answered',
        message: 'This question was not shown for the answers given, so it cannot be answered.',
      });
      continue;
    }
    const problem = answerProblem(field, value);
    if (problem !== null) problems.push({ fieldId: id, code: 'invalid', message: problem });
  }

  if (options.complete) {
    for (const id of path) {
      const field = fields.get(id)!;
      if (field.required && !isAnswered(known[id])) {
        problems.push({ fieldId: id, code: 'required', message: requiredMessage(field) });
      }
    }
  }

  return { ok: problems.length === 0, answers: known, path, problems };
}

/**
 * The part of the path a respondent has reached: the walk up to and including
 * `current`, or the whole path when they are finished.
 *
 * Returns null when `current` is not on the path its own answers produce, which
 * is a client claiming to stand on a question it has routed around.
 */
export function reachedPath(path: readonly FieldId[], current: FieldId | null): FieldId[] | null {
  if (current === null) return [...path];
  const position = path.indexOf(current);
  return position === -1 ? null : path.slice(0, position + 1);
}
