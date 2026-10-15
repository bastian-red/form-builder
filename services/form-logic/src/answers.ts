/**
 * One answer against one field: is it there, and is it acceptable.
 *
 * The same functions run in the respondent's browser (to show the error under
 * the input before a round trip) and in the API (to refuse a submission that
 * skipped the browser). That they are the same functions is the point: two
 * implementations of "what counts as a valid NPS answer" agree until the first
 * edge case, and the edge case is always found by a respondent.
 *
 * Messages are written for the respondent, in the second person, and never
 * quote the value back.
 */
import type { AnswerValue, Answers, Field, FieldId } from '@forms/shared';

/**
 * Whether a value counts as an answer.
 *
 * Whitespace-only text and an empty selection are NOT answers. Without this, a
 * required question could be satisfied by a space, and a condition
 * `answered(email)` would be true for a respondent who typed nothing.
 */
export function isAnswered(value: AnswerValue | null | undefined): value is AnswerValue {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Drop every key whose value is not an answer, and trim text.
 *
 * Run first on every submission, server side, so "absent", "empty string" and
 * "empty list" are one state everywhere after it. A client that sends `""` for a
 * skipped optional question is not doing anything wrong and must not be refused
 * for it.
 */
export function normalizeAnswers(answers: Answers): Answers {
  const out: Answers = {};
  for (const [id, value] of Object.entries(answers) as Array<[FieldId, AnswerValue]>) {
    if (!isAnswered(value)) continue;
    out[id] = typeof value === 'string' ? value.trim() : value;
  }
  return out;
}

/** Length in code points, so an emoji counts as one character and not two. */
export function textLength(value: string): number {
  return Array.from(value).length;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/**
 * A real calendar date in `YYYY-MM-DD`. `2026-02-30` matches the pattern and is
 * not a date; the round trip through `Date.UTC` is what catches it. UTC, so the
 * answer does not depend on the time zone of whichever machine checks it.
 */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * The problem with an answered value, or null when it is acceptable.
 *
 * Call only with an answered value (`isAnswered`); "missing" is the caller's
 * concern, because whether missing is a problem depends on `required` and on
 * whether the respondent is finished.
 */
export function answerProblem(field: Field, value: AnswerValue): string | null {
  switch (field.type) {
    case 'statement':
      return 'This screen does not take an answer.';
    case 'short_text':
    case 'long_text': {
      if (typeof value !== 'string') return 'Type your answer as text.';
      const length = textLength(value.trim());
      if (length > field.maxLength) {
        return `Keep it to ${String(field.maxLength)} characters or fewer.`;
      }
      return null;
    }
    case 'email': {
      if (typeof value !== 'string') return 'Enter an email address.';
      const trimmed = value.trim();
      if (trimmed.length > 254 || !EMAIL.test(trimmed)) {
        return 'That does not look like an email address.';
      }
      return null;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number.';
      if (field.integer && !Number.isInteger(value)) return 'Enter a whole number.';
      if (field.min !== undefined && value < field.min) {
        return `Enter a number of at least ${String(field.min)}.`;
      }
      if (field.max !== undefined && value > field.max) {
        return `Enter a number of at most ${String(field.max)}.`;
      }
      return null;
    }
    case 'single_choice': {
      if (typeof value !== 'string' || !field.options.some((option) => option.id === value)) {
        return 'Choose one of the options.';
      }
      return null;
    }
    case 'multi_choice': {
      if (!Array.isArray(value)) return 'Choose from the options.';
      const known = new Set(field.options.map((option) => option.id));
      if (value.some((id) => !known.has(id))) return 'Choose from the options.';
      if (new Set(value).size !== value.length) return 'Choose each option at most once.';
      if (field.minSelected !== undefined && value.length < field.minSelected) {
        return `Choose at least ${String(field.minSelected)}.`;
      }
      if (field.maxSelected !== undefined && value.length > field.maxSelected) {
        return `Choose at most ${String(field.maxSelected)}.`;
      }
      return null;
    }
    case 'rating': {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > field.scale
      ) {
        return `Choose a rating from 1 to ${String(field.scale)}.`;
      }
      return null;
    }
    case 'nps': {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10) {
        return 'Choose a score from 0 to 10.';
      }
      return null;
    }
    case 'date': {
      if (typeof value !== 'string' || !isCalendarDate(value)) return 'Enter a real date.';
      return null;
    }
    case 'yes_no': {
      if (typeof value !== 'boolean') return 'Choose yes or no.';
      return null;
    }
  }
}

/** The respondent-facing sentence for a required question left empty. */
export function requiredMessage(field: Field): string {
  switch (field.type) {
    case 'single_choice':
    case 'yes_no':
      return 'Choose an answer to continue.';
    case 'multi_choice':
      return 'Choose at least one option to continue.';
    case 'rating':
    case 'nps':
      return 'Pick a score to continue.';
    default:
      return 'This question needs an answer.';
  }
}
