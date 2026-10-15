import type { FormDefinition } from '@forms/shared';
import { describe, expect, it } from 'vitest';

import { COMPANY, FORM, MANAGER, RECOMMEND, REPORTS, ROLE, STUDENT } from './fixtures.test-helpers';
import { firstField, nextField, progress, submission } from './navigator';

/** The fixture, with "Company" shown only to people who answered the manager question. */
const COMPANY_IF_REPORTS: FormDefinition = {
  ...FORM,
  fields: FORM.fields.map((field) =>
    field.id === COMPANY ? { ...field, showIf: { op: 'answered', field: REPORTS } } : field,
  ),
};

describe('navigator', () => {
  it('starts at the first shown question', () => {
    expect(firstField(FORM)).toBe(ROLE);
    expect(firstField({ ...FORM, fields: [] })).toBeNull();
  });

  it('does not let a stale answer from an abandoned branch open a question', () => {
    // Manager, 40 reports, then Back twice and switch to Student. The "40" is
    // still in the answers (Back keeps it), but REPORTS is no longer shown, so
    // COMPANY -- shown only if REPORTS is answered -- must not appear.
    const answers = { [ROLE]: MANAGER, [REPORTS]: 40 };
    expect(nextField(COMPANY_IF_REPORTS, [ROLE], answers)).toBe(REPORTS);
    expect(nextField(COMPANY_IF_REPORTS, [ROLE, REPORTS], answers)).toBe(COMPANY);

    const switched = { ...answers, [ROLE]: STUDENT };
    expect(nextField(COMPANY_IF_REPORTS, [ROLE], switched)).toBe(RECOMMEND);
    expect(submission([ROLE], switched)).toEqual({ [ROLE]: STUDENT });
  });

  it('refuses to guess when the caller has lost track of the current question', () => {
    expect(() => nextField(FORM, [], {})).toThrow(/current question/u);
    expect(() => nextField(FORM, ['f_zzzzzzzz'], {})).toThrow(/not a field/u);
  });

  it('estimates progress without running behind what was shown', () => {
    expect(progress(FORM, [ROLE], {})).toEqual({ position: 1, total: 7 });
    expect(progress(FORM, [ROLE, REPORTS], { [ROLE]: MANAGER })).toEqual({ position: 2, total: 8 });
  });
});
