/**
 * The respondent's navigator: one question at a time, with Back.
 *
 * The respondent renderer does not call `walk` on every keystroke. It keeps a
 * HISTORY -- the questions shown so far, the current one last -- and asks for
 * the next question given only what is in that history. Back pops the history.
 *
 * Answers are deliberately NOT cleared on Back. Somebody who goes back to fix a
 * typo and comes forward along the same branch should find their later answers
 * still there. The price is that `answers` can hold values for questions that
 * are no longer on the path (they changed an earlier answer and took another
 * branch), and that is why `submission()` prunes to the history before anything
 * is sent. The server then walks the pruned answers itself and must arrive at
 * exactly this history; `navigator.property.test.ts` holds that over thousands
 * of generated forms and back-and-forth respondents.
 */
import type { AnswerValue, Answers, FieldId, FormDefinition } from '@forms/shared';
import { isAnswerable } from '@forms/shared';

import { isAnswered, normalizeAnswers } from './answers';
import { followJumps, indexOf, isShown, pruneToPath, walk } from './walk';

/** The answered values of the fields in the history: the only answers logic may read. */
function scopeOf(
  definition: FormDefinition,
  history: readonly FieldId[],
  answers: Answers,
): Map<FieldId, AnswerValue> {
  const answerable = new Set(definition.fields.filter(isAnswerable).map((field) => field.id));
  const scope = new Map<FieldId, AnswerValue>();
  for (const id of history) {
    const value = answers[id];
    if (answerable.has(id) && isAnswered(value)) scope.set(id, value);
  }
  return scope;
}

/** The first shown position at or after `from`, or null at the end. */
function firstShownFrom(
  definition: FormDefinition,
  from: number,
  scope: ReadonlyMap<FieldId, AnswerValue>,
): FieldId | null {
  for (let position = from; position < definition.fields.length; position += 1) {
    if (isShown(definition, position, scope)) return definition.fields[position]!.id;
  }
  return null;
}

/** The first question a respondent sees, or null for a form with nothing to show. */
export function firstField(definition: FormDefinition): FieldId | null {
  return firstShownFrom(definition, 0, new Map());
}

/**
 * The question after the current one (the last in `history`), or null when the
 * form is finished.
 *
 * Throws on an empty history or one whose last id is not a field of this form:
 * both are bugs in the caller, and guessing would send a respondent somewhere
 * the server will later refuse.
 */
export function nextField(
  definition: FormDefinition,
  history: readonly FieldId[],
  answers: Answers,
): FieldId | null {
  const current = history.at(-1);
  if (current === undefined) throw new Error('nextField needs a current question');
  const index = indexOf(definition);
  const position = index.get(current);
  if (position === undefined) throw new Error(`${current} is not a field of this form`);

  const scope = scopeOf(definition, history, answers);
  return firstShownFrom(definition, followJumps(definition, index, position, scope), scope);
}

/** What gets sent: the answers of the questions actually shown, normalized. */
export function submission(history: readonly FieldId[], answers: Answers): Answers {
  return normalizeAnswers(pruneToPath(answers, history));
}

/**
 * "Question n of m" for the progress bar.
 *
 * `m` is an estimate: the length of the path the answers so far lead to, with
 * every later question treated as unanswered. It can grow when a later answer
 * opens a branch, and it never drops below what has already been shown, so the
 * bar never runs backwards while someone moves forwards.
 */
export function progress(
  definition: FormDefinition,
  history: readonly FieldId[],
  answers: Answers,
): { position: number; total: number } {
  const estimate = walk(definition, pruneToPath(answers, history)).length;
  return { position: history.length, total: Math.max(history.length, estimate) };
}
