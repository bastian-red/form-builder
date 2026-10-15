/**
 * Condition evaluation: the one definition of what a rule means
 * (docs/SPECS.md 4).
 *
 * Three rules, each chosen so that a respondent who skips a question can never
 * be routed somewhere surprising:
 *
 * 1. A condition reads only answers that are IN SCOPE -- answers to fields
 *    already on the respondent's path. The caller builds the scope; this file
 *    never sees the full answer set, so a stale answer to a question that was
 *    later hidden cannot steer anything.
 * 2. Every comparison on an unanswered field is false. Including `neq`: "role is
 *    not Manager" must not be true for somebody who has not said what their role
 *    is. `not(answered(x))` is how a form asks "skipped".
 * 3. `all([])` is true and `any([])` is false, the identities of AND and OR. An
 *    unconditional jump is `{ op: 'all', of: [] }`.
 *
 * A comparison whose operand is the wrong type for the answer (a number against
 * a text answer) is false rather than an error. The analyzer refuses to publish
 * such a rule; at evaluation time "false" is the answer that changes nothing.
 */
import type { AnswerValue, Condition, ConditionValue, FieldId } from '@forms/shared';

/** The answers in scope, by field id. Absent means unanswered or out of scope. */
export type Scope = ReadonlyMap<FieldId, AnswerValue>;

/** Text equality: trimmed and case-insensitive, so "Yes" and "yes " are one answer. */
function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function equals(answer: AnswerValue, value: ConditionValue): boolean {
  if (typeof answer === 'string' && typeof value === 'string') return sameText(answer, value);
  if (typeof answer === 'number' && typeof value === 'number') return answer === value;
  if (typeof answer === 'boolean' && typeof value === 'boolean') return answer === value;
  // A list is never "equal" to a scalar. Multi-choice is asked with `includes`.
  return false;
}

export function evaluate(condition: Condition, scope: Scope): boolean {
  switch (condition.op) {
    case 'all':
      return condition.of.every((child) => evaluate(child, scope));
    case 'any':
      return condition.of.some((child) => evaluate(child, scope));
    case 'not':
      return !evaluate(condition.of, scope);
    case 'answered':
      return scope.has(condition.field);
    case 'eq': {
      const answer = scope.get(condition.field);
      return answer !== undefined && equals(answer, condition.value);
    }
    case 'neq': {
      const answer = scope.get(condition.field);
      return answer !== undefined && !equals(answer, condition.value);
    }
    case 'includes': {
      const answer = scope.get(condition.field);
      if (Array.isArray(answer)) return answer.includes(condition.value);
      // A single choice "includes" its one selection, so a rule written against
      // a multi-choice field keeps working if the author narrows it to single.
      return typeof answer === 'string' && answer === condition.value;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const answer = scope.get(condition.field);
      if (typeof answer !== 'number') return false;
      if (condition.op === 'gt') return answer > condition.value;
      if (condition.op === 'gte') return answer >= condition.value;
      if (condition.op === 'lt') return answer < condition.value;
      return answer <= condition.value;
    }
  }
}

/** Every field id a condition reads, in the order written, with repeats. */
export function referencedFields(condition: Condition): FieldId[] {
  switch (condition.op) {
    case 'all':
    case 'any':
      return condition.of.flatMap(referencedFields);
    case 'not':
      return referencedFields(condition.of);
    default:
      return [condition.field];
  }
}

/** Whether a condition is the literal "always": an `all` with no rules. */
export function isAlways(condition: Condition): boolean {
  return condition.op === 'all' && condition.of.length === 0;
}
