import { describe, expect, it } from 'vitest';

import {
  MAX_CONDITION_DEPTH,
  conditionSchema,
  emptyDefinition,
  fieldSchema,
  formDefinitionSchema,
  type Condition,
} from './definition';
import { newFieldId, newOptionId } from './ids';

describe('formDefinitionSchema', () => {
  it('accepts the definition a new form starts from', () => {
    expect(formDefinitionSchema.parse(emptyDefinition('Untitled form')).fields).toEqual([]);
  });

  it('accepts a draft whose logic is wrong, because refusing to save loses work', () => {
    // A jump to a question that does not exist is the analyzer's problem at
    // publish time. The schema only checks shape.
    const draft = {
      ...emptyDefinition('Draft'),
      fields: [
        {
          id: 'f_aaaaaaaa',
          type: 'yes_no',
          title: 'Ready?',
          required: false,
          jumps: [{ when: { op: 'all', of: [] }, to: 'f_zzzzzzzz' }],
        },
      ],
    };
    expect(formDefinitionSchema.safeParse(draft).success).toBe(true);
  });

  it('makes a required statement unrepresentable', () => {
    const statement = { id: 'f_aaaaaaaa', type: 'statement', title: 'Welcome', required: true };
    expect(fieldSchema.safeParse(statement).success).toBe(false);
    expect(fieldSchema.safeParse({ ...statement, required: false }).success).toBe(true);
  });

  it('refuses an id that a person could have typed', () => {
    const field = { id: 'question-1', type: 'nps', title: 'Recommend us?', required: true };
    expect(fieldSchema.safeParse(field).success).toBe(false);
  });
});

describe('conditionSchema', () => {
  function nested(depth: number): Condition {
    let condition: Condition = { op: 'answered', field: 'f_aaaaaaaa' };
    for (let i = 1; i < depth; i += 1) condition = { op: 'not', of: condition };
    return condition;
  }

  it('accepts nesting up to the bound', () => {
    expect(conditionSchema.safeParse(nested(MAX_CONDITION_DEPTH)).success).toBe(true);
  });

  it('refuses a tree deeper than the bound, which would otherwise be evaluated recursively', () => {
    expect(conditionSchema.safeParse(nested(MAX_CONDITION_DEPTH + 1)).success).toBe(false);
  });

  it('refuses includes with a value that is not an option id', () => {
    expect(
      conditionSchema.safeParse({ op: 'includes', field: 'f_aaaaaaaa', value: 'Manager' }).success,
    ).toBe(false);
  });
});

describe('ids', () => {
  it('have the shape the schema accepts', () => {
    expect(newFieldId()).toMatch(/^f_[a-z0-9]{8}$/u);
    expect(newOptionId()).toMatch(/^o_[a-z0-9]{8}$/u);
  });

  it('redraw bytes at or above 252, so every character is equally likely', () => {
    // 252..255 would map to 0..3 a second time; a source that only ever returns
    // them must never produce a character from them.
    let calls = 0;
    const source = (length: number) => {
      calls += 1;
      return new Uint8Array(length).fill(calls === 1 ? 255 : 10);
    };
    expect(newFieldId(source)).toBe('f_aaaaaaaa');
    expect(calls).toBe(2);
  });
});
