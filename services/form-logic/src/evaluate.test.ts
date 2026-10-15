import type { AnswerValue, FieldId } from '@forms/shared';
import { describe, expect, it } from 'vitest';

import { evaluate, isAlways, referencedFields } from './evaluate';

const A = 'f_aaaaaaaa';
const B = 'f_bbbbbbbb';
const scope = (entries: Array<[FieldId, AnswerValue]>) => new Map(entries);

describe('evaluate', () => {
  it('treats every comparison on an unanswered field as false, including neq', () => {
    // "role is not Manager" must not route somebody who has not said their role.
    const empty = scope([]);
    expect(evaluate({ op: 'neq', field: A, value: 'o_aaaaaaaa' }, empty)).toBe(false);
    expect(evaluate({ op: 'eq', field: A, value: 'o_aaaaaaaa' }, empty)).toBe(false);
    expect(evaluate({ op: 'lt', field: A, value: 7 }, empty)).toBe(false);
    expect(evaluate({ op: 'not', of: { op: 'answered', field: A } }, empty)).toBe(true);
  });

  it('uses the identities of AND and OR for empty lists', () => {
    expect(evaluate({ op: 'all', of: [] }, scope([]))).toBe(true);
    expect(evaluate({ op: 'any', of: [] }, scope([]))).toBe(false);
    expect(isAlways({ op: 'all', of: [] })).toBe(true);
  });

  it('compares text trimmed and case-insensitively', () => {
    expect(evaluate({ op: 'eq', field: A, value: 'yes' }, scope([[A, ' Yes ']]))).toBe(true);
  });

  it('never equates values of different types', () => {
    expect(evaluate({ op: 'eq', field: A, value: '7' }, scope([[A, 7]]))).toBe(false);
    expect(evaluate({ op: 'gt', field: A, value: 3 }, scope([[A, '7']]))).toBe(false);
  });

  it('answers includes for multi and for single choice', () => {
    expect(
      evaluate(
        { op: 'includes', field: A, value: 'o_aaaaaaaa' },
        scope([[A, ['o_bbbbbbbb', 'o_aaaaaaaa']]]),
      ),
    ).toBe(true);
    expect(
      evaluate({ op: 'includes', field: A, value: 'o_aaaaaaaa' }, scope([[A, 'o_aaaaaaaa']])),
    ).toBe(true);
  });

  it('nests', () => {
    const condition = {
      op: 'any' as const,
      of: [
        { op: 'gte' as const, field: A, value: 9 },
        {
          op: 'all' as const,
          of: [
            { op: 'eq' as const, field: B, value: true },
            { op: 'lt' as const, field: A, value: 3 },
          ],
        },
      ],
    };
    expect(
      evaluate(
        condition,
        scope([
          [A, 2],
          [B, true],
        ]),
      ),
    ).toBe(true);
    expect(
      evaluate(
        condition,
        scope([
          [A, 5],
          [B, true],
        ]),
      ),
    ).toBe(false);
    expect(referencedFields(condition)).toEqual([A, B, A]);
  });
});
