import type { Field } from '@forms/shared';
import { describe, expect, it } from 'vitest';

import { answerProblem, isAnswered, isCalendarDate, normalizeAnswers, textLength } from './answers';

const base = { id: 'f_aaaaaaaa', title: 'Q', required: true } as const;

describe('isAnswered', () => {
  it('does not count whitespace or an empty selection as an answer', () => {
    // Otherwise a required question is satisfied by a space.
    expect(isAnswered('   ')).toBe(false);
    expect(isAnswered([])).toBe(false);
    expect(isAnswered(undefined)).toBe(false);
  });

  it('counts zero and false, which are real answers', () => {
    // NPS 0 and "No" are the answers a naive truthiness check loses.
    expect(isAnswered(0)).toBe(true);
    expect(isAnswered(false)).toBe(true);
  });
});

describe('normalizeAnswers', () => {
  it('drops empties and trims text, so absent, "" and [] are one state', () => {
    expect(
      normalizeAnswers({ f_aaaaaaaa: '  hi ', f_bbbbbbbb: '', f_cccccccc: [], f_dddddddd: 0 }),
    ).toEqual({ f_aaaaaaaa: 'hi', f_dddddddd: 0 });
  });
});

describe('answerProblem', () => {
  it('counts text length in code points, so an emoji is one character', () => {
    expect(textLength('👍🏽')).toBe(2); // skin-tone modifier is its own code point
    const field: Field = { ...base, type: 'short_text', maxLength: 3 };
    expect(answerProblem(field, '👍👍👍')).toBeNull();
    expect(answerProblem(field, '👍👍👍👍')).toMatch(/3 characters/u);
  });

  it('enforces number bounds and integrality', () => {
    const field: Field = { ...base, type: 'number', integer: true, min: 1, max: 10 };
    expect(answerProblem(field, 5)).toBeNull();
    expect(answerProblem(field, 5.5)).toMatch(/whole/u);
    expect(answerProblem(field, 0)).toMatch(/at least 1/u);
    expect(answerProblem(field, 11)).toMatch(/at most 10/u);
    expect(answerProblem(field, '5')).toMatch(/Enter a number/u);
  });

  it('accepts only the options a choice field has', () => {
    const field: Field = {
      ...base,
      type: 'multi_choice',
      options: [
        { id: 'o_aaaaaaaa', label: 'A' },
        { id: 'o_bbbbbbbb', label: 'B' },
      ],
      maxSelected: 1,
    };
    expect(answerProblem(field, ['o_aaaaaaaa'])).toBeNull();
    expect(answerProblem(field, ['o_zzzzzzzz'])).toMatch(/options/u);
    expect(answerProblem(field, ['o_aaaaaaaa', 'o_aaaaaaaa'])).toMatch(/once/u);
    expect(answerProblem(field, ['o_aaaaaaaa', 'o_bbbbbbbb'])).toMatch(/at most 1/u);
  });

  it('bounds NPS to 0..10 and rating to 1..scale', () => {
    expect(answerProblem({ ...base, type: 'nps' }, 0)).toBeNull();
    expect(answerProblem({ ...base, type: 'nps' }, 11)).not.toBeNull();
    expect(answerProblem({ ...base, type: 'rating', scale: 5 }, 0)).not.toBeNull();
    expect(answerProblem({ ...base, type: 'rating', scale: 5 }, 5)).toBeNull();
  });

  it('refuses any answer to a statement', () => {
    expect(answerProblem({ ...base, required: false, type: 'statement' }, 'x')).not.toBeNull();
  });
});

describe('isCalendarDate', () => {
  it('refuses dates that match the pattern and do not exist', () => {
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2023-02-29')).toBe(false);
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('26-01-01')).toBe(false);
  });
});

describe('date answers do not depend on the machine time zone', () => {
  // CI runs the unit lane twice, the second time at Pacific/Kiritimati (UTC+14),
  // which is why TZ is declared in turbo.json. This test also sets it itself, so
  // it proves the property locally too: a date check built on local-time Date
  // methods would call 2024-02-29 invalid at UTC+14 near midnight and valid in
  // Santiago.
  it.each(['UTC', 'Pacific/Kiritimati', 'America/Santiago', 'Pacific/Pago_Pago'])(
    'agrees at %s',
    (zone) => {
      const original = process.env.TZ;
      process.env.TZ = zone;
      try {
        expect(isCalendarDate('2024-02-29')).toBe(true);
        expect(isCalendarDate('2023-02-29')).toBe(false);
        expect(isCalendarDate('2026-12-31')).toBe(true);
        expect(
          answerProblem(
            { id: 'f_aaaaaaaa', title: 'When?', required: true, type: 'date' },
            '2026-01-01',
          ),
        ).toBeNull();
      } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
      }
    },
  );
});
