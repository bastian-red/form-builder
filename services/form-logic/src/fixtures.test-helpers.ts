/**
 * A small form with every kind of logic, shared by the unit tests.
 *
 *   1 role        single choice: student / manager / other
 *   2 reports     number, shown only if role is manager
 *   3 company     short text, optional
 *   4 recommend   NPS; jumps to 6 when the score is below 7
 *   5 why_great   long text, required (promoters and passives only)
 *   6 contact_ok  yes/no; jumps to the end when No
 *   7 email       email, required
 *   8 thanks      statement
 */
import type { FormDefinition } from '@forms/shared';

export const ROLE = 'f_role0001';
export const REPORTS = 'f_report01';
export const COMPANY = 'f_compan01';
export const RECOMMEND = 'f_recomm01';
export const WHY = 'f_whygrt01';
export const CONTACT = 'f_contct01';
export const EMAIL = 'f_email001';
export const THANKS = 'f_thanks01';

export const STUDENT = 'o_student1';
export const MANAGER = 'o_manager1';
export const OTHER = 'o_other001';

export const FORM: FormDefinition = {
  schemaVersion: 1,
  title: 'Product feedback',
  ending: { title: 'Thank you', message: 'Recorded.' },
  fields: [
    {
      id: ROLE,
      type: 'single_choice',
      title: 'What is your role?',
      required: true,
      options: [
        { id: STUDENT, label: 'Student' },
        { id: MANAGER, label: 'Manager' },
        { id: OTHER, label: 'Other' },
      ],
    },
    {
      id: REPORTS,
      type: 'number',
      title: 'How many people report to you?',
      required: true,
      integer: true,
      min: 1,
      max: 500,
      showIf: { op: 'eq', field: ROLE, value: MANAGER },
    },
    { id: COMPANY, type: 'short_text', title: 'Company', required: false, maxLength: 80 },
    {
      id: RECOMMEND,
      type: 'nps',
      title: 'How likely are you to recommend us?',
      required: true,
      jumps: [{ when: { op: 'lt', field: RECOMMEND, value: 7 }, to: CONTACT }],
    },
    {
      id: WHY,
      type: 'long_text',
      title: 'What do you like most?',
      required: true,
      maxLength: 2000,
    },
    {
      id: CONTACT,
      type: 'yes_no',
      title: 'May we contact you?',
      required: true,
      jumps: [{ when: { op: 'eq', field: CONTACT, value: false }, to: 'end' }],
    },
    { id: EMAIL, type: 'email', title: 'Your email', required: true },
    { id: THANKS, type: 'statement', title: 'Thanks!', required: false },
  ],
};
