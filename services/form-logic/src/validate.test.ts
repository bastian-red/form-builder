import { describe, expect, it } from 'vitest';

import {
  CONTACT,
  EMAIL,
  FORM,
  MANAGER,
  RECOMMEND,
  REPORTS,
  ROLE,
  STUDENT,
  THANKS,
  WHY,
} from './fixtures.test-helpers';
import { reachedPath, validateSubmission } from './validate';

const complete = { complete: true } as const;
const partial = { complete: false } as const;

describe('validateSubmission', () => {
  it('accepts a complete student submission', () => {
    const result = validateSubmission(
      FORM,
      { [ROLE]: STUDENT, [RECOMMEND]: 10, [WHY]: 'Speed', [CONTACT]: true, [EMAIL]: 'a@b.co' },
      complete,
    );
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('refuses an answer to a question the answers route around', () => {
    // The scripted-client case: a student answering the manager-only question.
    const result = validateSubmission(
      FORM,
      { [ROLE]: STUDENT, [REPORTS]: 12, [RECOMMEND]: 3, [CONTACT]: false },
      complete,
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      expect.objectContaining({ fieldId: REPORTS, code: 'hidden_answered' }),
    ]);
  });

  it('refuses a missing required answer only when finished', () => {
    const answers = { [ROLE]: MANAGER };
    expect(validateSubmission(FORM, answers, partial).ok).toBe(true);
    const final = validateSubmission(FORM, answers, complete);
    expect(final.problems.map((problem) => [problem.fieldId, problem.code])).toEqual([
      [REPORTS, 'required'],
      [RECOMMEND, 'required'],
      [WHY, 'required'],
      [CONTACT, 'required'],
      [EMAIL, 'required'],
    ]);
  });

  it('refuses unknown keys, wrong types and answers to statements', () => {
    const result = validateSubmission(
      FORM,
      { [ROLE]: 'o_nonexist', f_zzzzzzzz: 'x', [THANKS]: 'hi' },
      partial,
    );
    expect(result.problems.map((problem) => problem.code).sort()).toEqual([
      'invalid',
      'invalid',
      'unknown_field',
    ]);
  });

  it('treats an empty string as not answered rather than invalid', () => {
    const result = validateSubmission(FORM, { [ROLE]: STUDENT, [WHY]: '   ' }, partial);
    expect(result.ok).toBe(true);
    expect(result.answers).toEqual({ [ROLE]: STUDENT });
  });
});

describe('reachedPath', () => {
  it('cuts the path at the current question', () => {
    expect(reachedPath([ROLE, REPORTS, RECOMMEND], REPORTS)).toEqual([ROLE, REPORTS]);
    expect(reachedPath([ROLE, REPORTS], null)).toEqual([ROLE, REPORTS]);
  });

  it('refuses a current question that is not on the path', () => {
    expect(reachedPath([ROLE, RECOMMEND], REPORTS)).toBeNull();
  });
});
