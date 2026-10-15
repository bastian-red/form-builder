import { describe, expect, it } from 'vitest';

import { assignLanes } from './lanes';

describe('assignLanes', () => {
  it('reuses a lane once the span before it has ended', () => {
    const { lanes, count } = assignLanes([
      { id: 'a', from: 0, to: 2 },
      { id: 'b', from: 3, to: 5 },
    ]);
    expect(count).toBe(1);
    expect(lanes.get('a')).toBe(0);
    expect(lanes.get('b')).toBe(0);
  });

  it('separates spans that touch at one block, so two jumps never read as one line', () => {
    const { lanes } = assignLanes([
      { id: 'a', from: 0, to: 2 },
      { id: 'b', from: 2, to: 4 },
    ]);
    expect(lanes.get('a')).not.toBe(lanes.get('b'));
  });

  it('uses exactly as many lanes as the most spans crossing one point', () => {
    // Crossing at block 3: a, b and c. d starts after a ends.
    const { lanes, count } = assignLanes([
      { id: 'a', from: 1, to: 3 },
      { id: 'b', from: 0, to: 6 },
      { id: 'c', from: 2, to: 4 },
      { id: 'd', from: 4, to: 5 },
    ]);
    expect(count).toBe(3);
    // No two overlapping spans share a lane.
    const spans = { a: [1, 3], b: [0, 6], c: [2, 4], d: [4, 5] } as const;
    for (const [x, [xl, xh]] of Object.entries(spans)) {
      for (const [y, [yl, yh]] of Object.entries(spans)) {
        if (x >= y) continue;
        const overlap = xl <= yh && yl <= xh;
        if (overlap) expect(lanes.get(x), `${x} vs ${y}`).not.toBe(lanes.get(y));
      }
    }
  });

  it('is deterministic whatever order the edges arrive in', () => {
    const edges = [
      { id: 'a', from: 0, to: 4 },
      { id: 'b', from: 1, to: 2 },
      { id: 'c', from: 3, to: 6 },
    ];
    const forward = assignLanes(edges);
    const backward = assignLanes([...edges].reverse());
    expect([...backward.lanes.entries()].sort()).toEqual([...forward.lanes.entries()].sort());
  });
});
