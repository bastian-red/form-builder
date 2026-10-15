/**
 * Lanes for the logic gutter (docs/DESIGN.md 4).
 *
 * Every jump is drawn as a connector in the gutter to the left of the spine,
 * from its source block down to its target. Two connectors whose vertical spans
 * overlap must not share a vertical line, or the reader cannot tell which jump
 * goes where. This assigns each edge the innermost lane free over its span:
 * interval-graph colouring, greedy by start, which is optimal for intervals (the
 * number of lanes equals the most edges crossing any one point).
 *
 * Spans are in block positions and INCLUSIVE at both ends, so two jumps that
 * meet at one block (one ends where the next starts) take separate lanes: they
 * would otherwise draw a single continuous line that reads as one jump.
 */
export interface Edge {
  readonly id: string;
  readonly from: number;
  readonly to: number;
}

export interface LaneLayout {
  readonly lanes: ReadonlyMap<string, number>;
  readonly count: number;
}

export function assignLanes(edges: readonly Edge[]): LaneLayout {
  const spans = edges
    .map((edge) => ({
      id: edge.id,
      low: Math.min(edge.from, edge.to),
      high: Math.max(edge.from, edge.to),
    }))
    .sort((a, b) => a.low - b.low || a.high - b.high || a.id.localeCompare(b.id));

  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const span of spans) {
    let lane = laneEnds.findIndex((end) => end < span.low);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(span.high);
    } else {
      laneEnds[lane] = span.high;
    }
    lanes.set(span.id, lane);
  }
  return { lanes, count: laneEnds.length };
}
