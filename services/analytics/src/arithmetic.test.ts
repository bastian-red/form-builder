import { describe, expect, it } from 'vitest';

import { histogram, mean, median, nps } from './arithmetic';

/**
 * Expected values were computed by expanding the counts into a sorted list and
 * taking the textbook statistic in a separate script, then pasted here
 * (an expected value is deterministic work too: computed, never recalled).
 */
describe('median', () => {
  it('is the middle value of an odd multiset', () => {
    // [1, 3, 3, 10, 10]
    expect(
      median([
        { value: 3, count: 2 },
        { value: 1, count: 1 },
        { value: 10, count: 2 },
      ]),
    ).toBe(3);
  });

  it('is the mean of the two middle values of an even multiset', () => {
    // [1, 2, 4, 9]
    expect(median([1, 2, 4, 9].map((value) => ({ value, count: 1 })))).toBe(3);
  });

  it('handles the middle pair straddling two entries and ignores zero counts', () => {
    // [5, 5, 7, 7]
    expect(
      median([
        { value: 7, count: 2 },
        { value: 6, count: 0 },
        { value: 5, count: 2 },
      ]),
    ).toBe(6);
  });

  it('is null with no answers', () => {
    expect(median([])).toBeNull();
    expect(mean([])).toBeNull();
  });
});

describe('nps', () => {
  it('splits 0-6, 7-8 and 9-10 and rounds half away from zero', () => {
    // 1 promoter, 5 passives, 2 detractors of 8: exactly -12.5. Math.round
    // would give -12 (it rounds half towards +infinity); the score is -13.
    const counts = [
      { value: 10, count: 1 },
      { value: 7, count: 3 },
      { value: 8, count: 2 },
      { value: 0, count: 1 },
      { value: 6, count: 1 },
    ];
    expect(nps(counts)).toEqual({ detractors: 2, passives: 5, promoters: 1, score: -13 });
  });

  it('is 33 for one promoter in three, and never -0', () => {
    expect(
      nps([
        { value: 9, count: 1 },
        { value: 7, count: 2 },
      ]).score,
    ).toBe(33);
    expect(Object.is(nps([{ value: 8, count: 4 }]).score, 0)).toBe(true);
    expect(nps([]).score).toBeNull();
  });
});

describe('histogram', () => {
  it('gives a small whole-number range one bin per value, including empty ones', () => {
    expect(
      histogram(
        [
          { value: 1, count: 2 },
          { value: 3, count: 1 },
        ],
        { integer: true, min: 1, max: 4 },
      ),
    ).toEqual([
      { from: 1, to: 1, count: 2 },
      { from: 2, to: 2, count: 0 },
      { from: 3, to: 3, count: 1 },
      { from: 4, to: 4, count: 0 },
    ]);
  });

  it('pins the domain to the field bounds, so the maximum lands in the last bin', () => {
    const bins = histogram(
      [
        { value: 0, count: 1 },
        { value: 100, count: 1 },
        { value: 55, count: 3 },
      ],
      {
        integer: false,
        min: 0,
        max: 100,
      },
    );
    expect(bins).toHaveLength(10);
    expect(bins[0]).toEqual({ from: 0, to: 10, count: 1 });
    expect(bins[5]).toEqual({ from: 50, to: 60, count: 3 });
    expect(bins[9]).toEqual({ from: 90, to: 100, count: 1 });
  });

  it('gives a wide whole-number range whole-number edges, each integer in one bin', () => {
    // 1..200 in ten bins of 20: 1-20, 21-40, ... 181-200.
    const bins = histogram(
      [
        { value: 20, count: 1 },
        { value: 21, count: 2 },
        { value: 200, count: 3 },
      ],
      { integer: true, min: 1, max: 200 },
    );
    expect(bins).toHaveLength(10);
    expect(bins[0]).toEqual({ from: 1, to: 20, count: 1 });
    expect(bins[1]).toEqual({ from: 21, to: 40, count: 2 });
    expect(bins[9]).toEqual({ from: 181, to: 200, count: 3 });
  });

  it('falls back to the data range and survives a single value', () => {
    expect(histogram([{ value: 7.5, count: 4 }], { integer: false })).toEqual([
      { from: 7.5, to: 7.5, count: 4 },
    ]);
    expect(histogram([], { integer: false })).toEqual([]);
  });
});
