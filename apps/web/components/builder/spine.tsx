'use client';

/**
 * The spine: the form's questions in one numbered column, the logic gutter
 * beside it, and the ending at the foot (docs/DESIGN.md 4).
 *
 * Reordering is dnd-kit's sortable list, vertical only, with keyboard sorting
 * (focus a handle, Space to lift, arrows to move, Space to drop, Escape to
 * cancel) and announcements that name the question and its new number, so a
 * screen-reader user hears "Moved “Role” to position 3 of 8" rather than
 * dnd-kit's default "draggable item f_k2m9x0qa".
 *
 * Block positions are MEASURED (ResizeObserver), not assumed: a block grows with
 * its logic sentences and issues, and a connector drawn to a computed height is
 * a connector drawn to the wrong question.
 */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { AnalyzerIssue, FormDefinition } from '@forms/shared';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Block } from './block';
import { Gutter, type BlockBox } from './gutter';

interface Props {
  readonly definition: FormDefinition;
  readonly selectedId: string | null;
  readonly issuesByField: ReadonlyMap<string, AnalyzerIssue[]>;
  readonly broken: ReadonlySet<string>;
  readonly onSelect: (id: string | null) => void;
  readonly onMove: (from: number, to: number) => void;
  readonly onInsert: (at: number) => void;
}

export const ENDING_ID = 'ending';

export function Spine({
  definition,
  selectedId,
  issuesByField,
  broken,
  onSelect,
  onMove,
  onInsert,
}: Props) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const nodes = useRef(new Map<string, HTMLLIElement>());
  const [boxes, setBoxes] = useState<ReadonlyMap<string, BlockBox>>(new Map());
  const [endTop, setEndTop] = useState(0);

  const sensors = useSensors(
    // A small distance, so a click on the handle is not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(() => definition.fields.map((field) => field.id), [definition.fields]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const measure = () => {
      const origin = list.getBoundingClientRect().top;
      const next = new Map<string, BlockBox>();
      for (const [id, node] of nodes.current) {
        const rect = node.getBoundingClientRect();
        next.set(id, { top: rect.top - origin, height: rect.height });
      }
      setBoxes(next);
      if (endRef.current) setEndTop(endRef.current.getBoundingClientRect().top - origin);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const node of nodes.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [definition]);

  const label = (id: string | number) => {
    const at = definition.fields.findIndex((field) => field.id === id);
    return at === -1 ? 'the question' : `“${definition.fields[at]!.title}”`;
  };
  const positionOf = (id: string | number | undefined) =>
    definition.fields.findIndex((field) => field.id === id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${label(active.id)}, question ${String(positionOf(active.id))} of ${String(ids.length)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${label(active.id)} is over position ${String(positionOf(over.id))} of ${String(ids.length)}.`
        : `${label(active.id)} is not over a position.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Moved ${label(active.id)} to position ${String(positionOf(over.id))} of ${String(ids.length)}.`
        : `${label(active.id)} was dropped where it started.`,
    onDragCancel: ({ active }) =>
      `Moving cancelled. ${label(active.id)} is back at position ${String(positionOf(active.id))}.`,
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    onMove(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };

  return (
    <div className="spine-wrap">
      <Gutter
        definition={definition}
        boxes={boxes}
        endTop={endTop}
        broken={broken}
        selectedId={selectedId}
      />
      <div className="spine-column">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                'To move a question, press Space to pick it up, the arrow keys to move it, Space again to drop it, or Escape to cancel.',
            },
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="spine" ref={listRef} aria-label="Questions">
              {definition.fields.map((field, position) => (
                <Block
                  key={field.id}
                  ref={(node) => {
                    if (node) nodes.current.set(field.id, node);
                    else nodes.current.delete(field.id);
                  }}
                  field={field}
                  position={position}
                  definition={definition}
                  selected={selectedId === field.id}
                  issues={issuesByField.get(field.id) ?? []}
                  onSelect={() => onSelect(field.id)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        <button
          className="spine-add"
          type="button"
          onClick={() => onInsert(definition.fields.length)}
        >
          <span aria-hidden="true">+</span> Add a question
          <kbd className="spine-kbd" aria-hidden="true">
            /
          </kbd>
        </button>
        <div ref={endRef} className="spine-end">
          <button
            className="block-body spine-ending"
            type="button"
            aria-pressed={selectedId === ENDING_ID}
            onClick={() => onSelect(ENDING_ID)}
          >
            <span className="block-head">
              <span className="block-number mono" aria-hidden="true">
                ■
              </span>
              <span className="block-type">Ending</span>
            </span>
            <span className="block-title">{definition.ending.title}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
