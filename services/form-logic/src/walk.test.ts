import type { FormDefinition } from '@forms/shared';
import { describe, expect, it } from 'vitest';

import {
  COMPANY,
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
import { pruneToPath, walk } from './walk';

describe('walk', () => {
  it('shows the manager-only question only to managers', () => {
    expect(walk(FORM, { [ROLE]: STUDENT, [RECOMMEND]: 9, [CONTACT]: true })).toEqual([
      ROLE,
      COMPANY,
      RECOMMEND,
      WHY,
      CONTACT,
      EMAIL,
      THANKS,
    ]);
    expect(walk(FORM, { [ROLE]: MANAGER, [RECOMMEND]: 9, [CONTACT]: true })).toEqual([
      ROLE,
      REPORTS,
      COMPANY,
      RECOMMEND,
      WHY,
      CONTACT,
      EMAIL,
      THANKS,
    ]);
  });

  it('follows a jump forward and stops at end', () => {
    // Score 3 skips "what do you like most"; No ends the form.
    expect(walk(FORM, { [ROLE]: STUDENT, [RECOMMEND]: 3, [CONTACT]: false })).toEqual([
      ROLE,
      COMPANY,
      RECOMMEND,
      CONTACT,
    ]);
  });

  it('never lets an answer to a hidden question steer the path', () => {
    // A stale "reports" answer from somebody who switched to Student must not
    // count: it is not in scope because REPORTS is not on the path.
    const withStale = { [ROLE]: STUDENT, [REPORTS]: 40, [RECOMMEND]: 9, [CONTACT]: true };
    expect(walk(FORM, withStale)).not.toContain(REPORTS);
    expect(pruneToPath(withStale, walk(FORM, withStale))).not.toHaveProperty(REPORTS);
  });

  it('treats a backward jump as no jump, so a broken draft cannot hang the preview', () => {
    const looping: FormDefinition = {
      ...FORM,
      fields: FORM.fields.map((field) =>
        field.id === CONTACT
          ? { ...field, jumps: [{ when: { op: 'all', of: [] }, to: ROLE }] }
          : field,
      ),
    };
    const path = walk(looping, { [ROLE]: STUDENT, [RECOMMEND]: 9, [CONTACT]: true });
    expect(path).toEqual([ROLE, COMPANY, RECOMMEND, WHY, CONTACT, EMAIL, THANKS]);
  });

  it('ignores a jump to a field that does not exist', () => {
    const broken: FormDefinition = {
      ...FORM,
      fields: FORM.fields.map((field) =>
        field.id === ROLE
          ? { ...field, jumps: [{ when: { op: 'all', of: [] }, to: 'f_zzzzzzzz' }] }
          : field,
      ),
    };
    expect(walk(broken, { [ROLE]: STUDENT })[1]).toBe(COMPANY);
  });
});
