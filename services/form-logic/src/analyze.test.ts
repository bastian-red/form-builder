import type { FormDefinition } from '@forms/shared';
import { describe, expect, it } from 'vitest';

import { analyze, hasErrors } from './analyze';
import { describeCondition } from './describe';
import {
  COMPANY,
  CONTACT,
  EMAIL,
  FORM,
  MANAGER,
  RECOMMEND,
  REPORTS,
  ROLE,
  THANKS,
  WHY,
} from './fixtures.test-helpers';

function edit(
  change: (fields: FormDefinition['fields']) => FormDefinition['fields'],
): FormDefinition {
  return { ...FORM, fields: change(FORM.fields.map((field) => ({ ...field }))) };
}

const codes = (definition: FormDefinition) =>
  analyze(definition).map((issue) => [issue.code, issue.fieldId, issue.ref]);

describe('analyze', () => {
  it('finds nothing wrong with the fixture form', () => {
    expect(analyze(FORM)).toEqual([]);
  });

  it('refuses a backward jump and names both ends of the edge', () => {
    const looping = edit((fields) =>
      fields.map((field) =>
        field.id === EMAIL
          ? { ...field, jumps: [{ when: { op: 'all', of: [] }, to: ROLE }] }
          : field,
      ),
    );
    const issues = analyze(looping);
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'backward_jump',
        fieldId: EMAIL,
        ref: ROLE,
      }),
    ]);
    expect(issues[0]!.message).toMatch(/can only go forward/u);
    expect(hasErrors(issues)).toBe(true);
  });

  it('refuses a self-jump, which is the shortest loop', () => {
    const selfLoop = edit((fields) =>
      fields.map((field) =>
        field.id === COMPANY
          ? { ...field, jumps: [{ when: { op: 'answered', field: COMPANY }, to: COMPANY }] }
          : field,
      ),
    );
    expect(codes(selfLoop)).toEqual([['backward_jump', COMPANY, COMPANY]]);
  });

  it('refuses a visibility rule that reads its own or a later question', () => {
    const forward = edit((fields) =>
      fields.map((field) =>
        field.id === REPORTS
          ? { ...field, showIf: { op: 'eq', field: CONTACT, value: true } }
          : field,
      ),
    );
    expect(codes(forward)).toEqual([['forward_ref', REPORTS, CONTACT]]);
  });

  it('lets a jump read its own question, which runs after it is answered', () => {
    // The fixture's NPS jump reads NPS itself; that is the normal case.
    expect(FORM.fields.find((field) => field.id === RECOMMEND)?.jumps).toBeDefined();
    expect(analyze(FORM)).toEqual([]);
  });

  it('reports a reference to a deleted question and a deleted option', () => {
    const dangling = edit((fields) => fields.filter((field) => field.id !== ROLE));
    expect(codes(dangling)).toEqual([['dangling_ref', REPORTS, ROLE]]);

    const deletedOption = edit((fields) =>
      fields.map((field) =>
        field.id === ROLE && field.type === 'single_choice'
          ? { ...field, options: field.options.filter((option) => option.id !== MANAGER) }
          : field,
      ),
    );
    expect(codes(deletedOption)).toEqual([['type_mismatch', REPORTS, ROLE]]);
  });

  it('refuses comparing text as a number and equating a multi-choice', () => {
    const textCompare = edit((fields) =>
      fields.map((field) =>
        field.id === WHY ? { ...field, showIf: { op: 'gt', field: COMPANY, value: 3 } } : field,
      ),
    );
    expect(codes(textCompare)).toEqual([['type_mismatch', WHY, COMPANY]]);
  });

  it('refuses a condition on a statement, which never has an answer', () => {
    const fields = [...FORM.fields];
    const statementFirst = { ...FORM, fields: [fields[7]!, ...fields.slice(0, 7)] };
    statementFirst.fields[1] = {
      ...statementFirst.fields[1]!,
      showIf: { op: 'answered', field: THANKS },
    };
    expect(codes(statementFirst)).toEqual([['statement_condition', ROLE, THANKS]]);
  });

  it('warns, without blocking, about a question every path jumps past', () => {
    const skipped = edit((fields) =>
      fields.map((field) =>
        field.id === COMPANY
          ? { ...field, jumps: [{ when: { op: 'all', of: [] }, to: CONTACT }] }
          : field,
      ),
    );
    const issues = analyze(skipped);
    expect(issues.map((issue) => [issue.severity, issue.code, issue.fieldId])).toEqual([
      ['warning', 'unreachable', RECOMMEND],
      ['warning', 'unreachable', WHY],
    ]);
    expect(hasErrors(issues)).toBe(false);
  });

  it('reports an empty form, duplicate ids, too few options and inverted bounds', () => {
    expect(codes({ ...FORM, fields: [] })).toEqual([['no_fields', null, null]]);
    const dup = edit((fields) => [...fields, { ...fields[2]! }]);
    expect(codes(dup)).toContainEqual(['duplicate_id', COMPANY, null]);
    const bad = edit((fields) =>
      fields.map((field) => {
        if (field.id === ROLE && field.type === 'single_choice')
          return { ...field, options: field.options.slice(0, 1) };
        if (field.id === REPORTS && field.type === 'number') return { ...field, min: 10, max: 1 };
        return field;
      }),
    );
    const found = codes(bad).map((entry) => entry[0]);
    expect(found).toContain('too_few_options');
    expect(found).toContain('invalid_bounds');
  });
});

describe('describeCondition', () => {
  it('reads like a sentence, naming options by label', () => {
    expect(describeCondition({ op: 'eq', field: ROLE, value: MANAGER }, FORM)).toBe(
      '“What is your role?” is “Manager”',
    );
    expect(
      describeCondition(
        {
          op: 'all',
          of: [
            { op: 'lt', field: RECOMMEND, value: 7 },
            { op: 'not', of: { op: 'answered', field: COMPANY } },
          ],
        },
        FORM,
      ),
    ).toBe('“How likely are you to recommend us?” is less than 7 and “Company” is skipped');
    expect(describeCondition({ op: 'answered', field: 'f_zzzzzzzz' }, FORM)).toBe(
      'a deleted question is answered',
    );
  });
});
