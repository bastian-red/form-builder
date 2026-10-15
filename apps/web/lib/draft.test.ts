import { analyze } from '@forms/form-logic';
import {
  emptyDefinition,
  fieldSchema,
  FIELD_TYPES,
  type Field,
  type FormDefinition,
} from '@forms/shared';
import { describe, expect, it } from 'vitest';

import {
  changeType,
  duplicateField,
  fromRuleSet,
  insertField,
  makeRule,
  moveField,
  newField,
  operatorsFor,
  readableFields,
  removeField,
  toRuleSet,
} from './draft';

describe('newField', () => {
  it.each(FIELD_TYPES)('makes a %s the schema accepts', (type) => {
    expect(fieldSchema.safeParse(newField(type)).success).toBe(true);
  });

  it('gives a new choice question two options, so it publishes without edits', () => {
    const definition = insertField(emptyDefinition('T'), 0, newField('single_choice'));
    expect(analyze(definition)).toEqual([]);
  });
});

describe('moving and removing', () => {
  const a = newField('short_text');
  const b = newField('nps');
  const c = newField('yes_no');
  const definition: FormDefinition = { ...emptyDefinition('T'), fields: [a, b, c] };

  it('moves a block to a new position', () => {
    expect(moveField(definition, 0, 2).fields.map((field) => field.id)).toEqual([b.id, c.id, a.id]);
    expect(moveField(definition, 2, 0).fields.map((field) => field.id)).toEqual([c.id, a.id, b.id]);
  });

  it('leaves logic that a move breaks for the analyzer to report, rather than rewriting it', () => {
    const withJump = {
      ...definition,
      fields: [a, { ...b, jumps: [{ when: { op: 'all' as const, of: [] }, to: c.id }] }, c],
    };
    const moved = moveField(withJump, 2, 0);
    expect(analyze(moved).map((issue) => issue.code)).toContain('backward_jump');
  });

  it('removes by id', () => {
    expect(removeField(definition, b.id).fields.map((field) => field.id)).toEqual([a.id, c.id]);
  });
});

describe('changeType', () => {
  it('keeps the title, logic and options between single and multiple choice', () => {
    const single = {
      ...newField('single_choice'),
      title: 'Role',
      showIf: { op: 'answered' as const, field: 'f_aaaaaaaa' },
    } as Field;
    const multi = changeType(single, 'multi_choice');
    expect(multi.type).toBe('multi_choice');
    expect(multi.title).toBe('Role');
    expect(multi.showIf).toEqual(single.showIf);
    if (multi.type !== 'multi_choice' || single.type !== 'single_choice')
      throw new Error('types did not switch');
    expect(multi.options).toEqual(single.options);
    expect(fieldSchema.safeParse(multi).success).toBe(true);
  });

  it('never makes a required statement', () => {
    const required = { ...newField('short_text'), required: true } as Field;
    expect(changeType(required, 'statement').required).toBe(false);
  });
});

describe('duplicateField', () => {
  it('gives the copy and its options fresh ids and drops its jumps', () => {
    const source = {
      ...newField('single_choice'),
      jumps: [{ when: { op: 'all' as const, of: [] }, to: 'end' as const }],
    };
    const { definition, copyId } = duplicateField(
      { ...emptyDefinition('T'), fields: [source] },
      source.id,
    );
    const copy = definition.fields[1]!;
    expect(copy.id).toBe(copyId);
    expect(copy.id).not.toBe(source.id);
    expect(copy.jumps).toBeUndefined();
    if (copy.type !== 'single_choice' || source.type !== 'single_choice')
      throw new Error('type changed');
    expect(copy.options.map((option) => option.id)).not.toEqual(
      source.options.map((option) => option.id),
    );
  });
});

describe('rule sets', () => {
  it('round-trips a flat condition and shows not(answered) as "skipped"', () => {
    const condition = {
      op: 'any' as const,
      of: [
        { op: 'eq' as const, field: 'f_aaaaaaaa', value: 'o_aaaaaaaa' },
        { op: 'not' as const, of: { op: 'answered' as const, field: 'f_bbbbbbbb' } },
      ],
    };
    const set = toRuleSet(condition)!;
    expect(set.rules[1]).toEqual({ op: 'skipped', field: 'f_bbbbbbbb' });
    expect(fromRuleSet(set)).toEqual(condition);
  });

  it('refuses to flatten what it cannot draw, rather than losing part of it', () => {
    const nested = { op: 'all' as const, of: [{ op: 'any' as const, of: [] }] };
    expect(toRuleSet(nested)).toBeNull();
  });

  it('makes an empty rule set mean no condition', () => {
    expect(fromRuleSet({ match: 'all', rules: [] })).toBeUndefined();
  });
});

describe('operators and readable fields', () => {
  it('offers only comparisons the analyzer accepts for the type', () => {
    for (const type of FIELD_TYPES) {
      if (type === 'statement') continue;
      const target = newField(type);
      for (const choice of operatorsFor(target)) {
        const reader = {
          ...newField('yes_no'),
          showIf: fromRuleSet({ match: 'all', rules: [makeRule(target, choice.op)] }),
        };
        const definition = { ...emptyDefinition('T'), fields: [target, reader] };
        // A text "is" rule starts with an empty value, which is legal but empty;
        // what matters is that no default combination is a type error.
        expect(
          analyze(definition).filter((issue) => issue.code === 'type_mismatch'),
          `${type} ${choice.op}`,
        ).toEqual([]);
      }
    }
  });

  it('lets a visibility rule read only earlier questions, and a jump its own', () => {
    const fields = [newField('short_text'), newField('statement'), newField('nps')];
    const definition = { ...emptyDefinition('T'), fields };
    expect(readableFields(definition, 2, false).map((field) => field.id)).toEqual([fields[0]!.id]);
    expect(readableFields(definition, 2, true).map((field) => field.id)).toEqual([
      fields[0]!.id,
      fields[2]!.id,
    ]);
  });
});
