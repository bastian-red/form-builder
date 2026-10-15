'use client';

/**
 * The logic gutter: every jump drawn as a routed connector beside the spine
 * (docs/DESIGN.md 4). The signature of this product -- a branch is visible
 * without opening anything.
 *
 * A connector leaves the right edge of the gutter at its source block, runs left
 * to its lane, down to its target, and back right with an arrowhead. Lanes come
 * from `lib/lanes.ts`, so overlapping jumps never share a vertical line. A jump
 * the analyzer refuses (backward, to a deleted question) is drawn dashed with a
 * ✕ at its source: colour alone would not say "broken", because the danger red
 * and the olive collapse into one grey.
 *
 * Decorative for assistive technology (`aria-hidden`): every jump is also a
 * sentence inside its block ("↳ If … go to question 5"), which is the
 * accessible form of the same information.
 */
import type { FormDefinition } from '@forms/shared';

import { assignLanes } from '../../lib/lanes';

export interface BlockBox {
  readonly top: number;
  readonly height: number;
}

interface Props {
  readonly definition: FormDefinition;
  /** Measured block positions, by field id, relative to the spine. */
  readonly boxes: ReadonlyMap<string, BlockBox>;
  /** Where the "End" marker sits, relative to the spine. */
  readonly endTop: number;
  /** Jumps the analyzer refuses, as `${fieldId}->${target}`. */
  readonly broken: ReadonlySet<string>;
  readonly selectedId: string | null;
}

export const LANE_WIDTH = 12;
export const GUTTER_PAD = 14;

export function gutterWidth(lanes: number): number {
  return GUTTER_PAD * 2 + Math.max(1, lanes) * LANE_WIDTH;
}

export function edgesOf(
  definition: FormDefinition,
): Array<{ id: string; fromId: string; to: string; from: number; toIndex: number }> {
  const position = new Map(definition.fields.map((field, at) => [field.id, at] as const));
  const edges: Array<{ id: string; fromId: string; to: string; from: number; toIndex: number }> =
    [];
  definition.fields.forEach((field, at) => {
    (field.jumps ?? []).forEach((jump, index) => {
      const toIndex = jump.to === 'end' ? definition.fields.length : (position.get(jump.to) ?? -1);
      edges.push({
        id: `${field.id}#${String(index)}`,
        fromId: field.id,
        to: jump.to,
        from: at,
        toIndex,
      });
    });
  });
  return edges;
}

export function Gutter({ definition, boxes, endTop, broken, selectedId }: Props) {
  const edges = edgesOf(definition);
  const drawable = edges.filter((edge) => edge.toIndex !== -1);
  const { lanes, count } = assignLanes(
    drawable.map((edge) => ({ id: edge.id, from: edge.from, to: edge.toIndex })),
  );
  const width = gutterWidth(count);
  const height = Math.max(endTop + 24, ...[...boxes.values()].map((box) => box.top + box.height));

  const centre = (id: string): number | null => {
    const box = boxes.get(id);
    return box === undefined ? null : box.top + Math.min(28, box.height / 2);
  };

  return (
    <svg className="gutter" width={width} height={height} aria-hidden="true" focusable="false">
      <defs>
        <marker
          id="gutter-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path d="M0 0 8 4 0 8z" className="gutter-arrowhead" />
        </marker>
      </defs>
      {edges.map((edge) => {
        const y1 = centre(edge.fromId);
        if (y1 === null) return null;
        const isBroken = broken.has(`${edge.fromId}->${edge.to}`) || edge.toIndex === -1;
        const lane = lanes.get(edge.id) ?? 0;
        const x = width - GUTTER_PAD - lane * LANE_WIDTH - LANE_WIDTH / 2;
        const right = width - 2;
        if (edge.toIndex === -1) {
          // Target deleted: a stub that goes nowhere, ending in the ✕.
          return (
            <g key={edge.id} className="gutter-edge" data-broken="true">
              <path d={`M${right} ${y1}H${x}`} />
              <text x={x - 4} y={y1 + 4} className="gutter-x" textAnchor="end">
                ✕
              </text>
            </g>
          );
        }
        const y2 = edge.to === 'end' ? endTop + 12 : centre(edge.to);
        if (y2 === null) return null;
        const radius = Math.min(6, Math.abs(y2 - y1) / 2);
        const down = y2 > y1 ? 1 : -1;
        const d = [
          `M${right} ${y1}`,
          `H${x + radius}`,
          `Q${x} ${y1} ${x} ${y1 + radius * down}`,
          `V${y2 - radius * down}`,
          `Q${x} ${y2} ${x + radius} ${y2}`,
          `H${right}`,
        ].join(' ');
        const active = selectedId === edge.fromId || selectedId === edge.to;
        return (
          <g
            key={edge.id}
            className="gutter-edge"
            data-broken={isBroken || undefined}
            data-active={active || undefined}
          >
            <path d={d} markerEnd="url(#gutter-arrow)" />
            <circle cx={right - 1} cy={y1} r={2.5} className="gutter-origin" />
            {isBroken ? (
              <text x={x - 4} y={y1 + 4} className="gutter-x" textAnchor="end">
                ✕
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
