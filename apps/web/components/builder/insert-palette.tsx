'use client';

/**
 * The insert palette: "/" anywhere on the spine, or "Add a question".
 *
 * A native `<dialog>` opened with `showModal()`, which gives the focus trap,
 * Escape to close and an inert page behind it for free and correctly. The list
 * is a listbox driven from the filter input (`aria-activedescendant`), so focus
 * stays in the input while arrows move the choice: type "nu", press Enter, and a
 * Number question is on the spine.
 */
import type { FieldType } from '@forms/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { FIELD_TYPE_META } from '../../lib/draft';

interface Props {
  readonly open: boolean;
  readonly position: number;
  readonly onPick: (type: FieldType) => void;
  readonly onClose: () => void;
}

export function InsertPalette({ open, position, onPick, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === ''
      ? FIELD_TYPE_META
      : FIELD_TYPE_META.filter(
          (meta) => meta.label.toLowerCase().includes(q) || meta.hint.toLowerCase().includes(q),
        );
  }, [query]);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) {
      setQuery('');
      setActive(0);
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  const pick = (type: FieldType) => {
    onPick(type);
    onClose();
  };

  return (
    <dialog ref={dialog} className="palette" aria-labelledby={`${listId}-title`} onClose={onClose}>
      <h2 id={`${listId}-title`} className="palette-title">
        Add question {position + 1}
      </h2>
      <input
        className="field-input palette-input"
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={matches[active] ? `${listId}-${matches[active].type}` : undefined}
        aria-label="Question type"
        placeholder="Filter types…"
        value={query}
        autoFocus
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(matches.length - 1, index + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const choice = matches[active];
            if (choice) pick(choice.type);
          }
        }}
      />
      <ul id={listId} className="palette-list" role="listbox" aria-label="Question types">
        {matches.map((meta, index) => (
          <li
            key={meta.type}
            id={`${listId}-${meta.type}`}
            role="option"
            aria-selected={index === active}
            className="palette-option"
            onMouseEnter={() => setActive(index)}
            onClick={() => pick(meta.type)}
          >
            <span className="palette-glyph" aria-hidden="true">
              {meta.glyph}
            </span>
            <span className="palette-label">{meta.label}</span>
            <span className="palette-hint">{meta.hint}</span>
          </li>
        ))}
        {matches.length === 0 ? (
          <li className="palette-empty">No question type matches “{query}”.</li>
        ) : null}
      </ul>
      <p className="palette-foot">
        <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to add, <kbd>Esc</kbd> to close
      </p>
    </dialog>
  );
}
