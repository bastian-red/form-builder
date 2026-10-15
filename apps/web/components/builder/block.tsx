'use client';

/**
 * One question on the spine.
 *
 * A numbered, ruled row: drag handle, number, type glyph, the question in Lora,
 * and under it the logic in sentences -- "Shown if …", "↳ If … go to 5" -- and
 * the analyzer's issues on this block, each a glyph and a sentence. The block is
 * a button (select it to edit in the inspector); the handle is a separate
 * button so keyboard sorting (space, arrows, space) does not fight selection.
 */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { describeCondition, positionLabel } from '@forms/form-logic';
import type { AnalyzerIssue, Field, FormDefinition } from '@forms/shared';
import { forwardRef, type Ref } from 'react';

import { typeMeta } from '../../lib/draft';

interface Props {
  readonly field: Field;
  readonly position: number;
  readonly definition: FormDefinition;
  readonly selected: boolean;
  readonly issues: readonly AnalyzerIssue[];
  readonly onSelect: () => void;
}

export const Block = forwardRef(function Block(
  { field, position, definition, selected, issues, onSelect }: Props,
  measureRef: Ref<HTMLLIElement>,
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });
  const meta = typeMeta(field.type);

  return (
    <li
      ref={(node) => {
        setNodeRef(node);
        if (typeof measureRef === 'function') measureRef(node);
        else if (measureRef !== null)
          (measureRef as { current: HTMLLIElement | null }).current = node;
      }}
      className="block"
      data-selected={selected || undefined}
      data-dragging={isDragging || undefined}
      data-issue={
        issues.some((issue) => issue.severity === 'error')
          ? 'error'
          : issues.length > 0
            ? 'warning'
            : undefined
      }
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        ref={setActivatorNodeRef}
        className="block-handle"
        type="button"
        aria-label={`Move question ${String(position + 1)}, ${field.title}`}
        {...attributes}
        {...listeners}
      >
        <svg viewBox="0 0 8 14" width="8" height="14" aria-hidden="true" focusable="false">
          {[2, 7, 12].map((y) => (
            <g key={y}>
              <circle cx="2" cy={y} r="1.2" />
              <circle cx="6" cy={y} r="1.2" />
            </g>
          ))}
        </svg>
      </button>
      <button className="block-body" type="button" onClick={onSelect} aria-pressed={selected}>
        <span className="block-head">
          <span className="block-number mono">{position + 1}</span>
          <span className="block-type">
            <span className="block-glyph" aria-hidden="true">
              {meta.glyph}
            </span>
            {meta.label}
          </span>
          {field.required ? <span className="block-required">Required</span> : null}
        </span>
        <span className="block-title">{field.title}</span>
        {field.showIf === undefined ? null : (
          <span className="block-logic">
            <span aria-hidden="true">◇ </span>Shown if {describeCondition(field.showIf, definition)}
          </span>
        )}
        {(field.jumps ?? []).map((jump, index) => (
          <span key={index} className="block-logic">
            <span aria-hidden="true">↳ </span>If {describeCondition(jump.when, definition)}, go to{' '}
            {jump.to === 'end' ? 'the end' : positionLabel(definition, jump.to)}
          </span>
        ))}
        {issues.map((issue, index) => (
          <span key={index} className="block-issue" data-severity={issue.severity}>
            <span aria-hidden="true">{issue.severity === 'error' ? '✕ ' : '⚠ '}</span>
            <span className="sr-only">{issue.severity === 'error' ? 'Error: ' : 'Warning: '}</span>
            {issue.message}
          </span>
        ))}
      </button>
    </li>
  );
});
