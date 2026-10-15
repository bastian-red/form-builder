'use client';

/**
 * The answer control for one question, by type.
 *
 * Every control is a native input (radio, checkbox, text, date) under its
 * styling, so a screen reader announces "radio button, 2 of 4, checked" without
 * any ARIA to keep in step, and a phone brings up the right keyboard. Choice
 * options carry a keycap (A, B, C...) that is both a visible label and the
 * keyboard shortcut; the keycap is decoration for a pointer and a promise for a
 * keyboard, so it is `aria-hidden` and the shortcut is announced once, in the
 * hint under the question.
 */
import type { AnswerValue, Field } from '@forms/shared';
import type { RefObject } from 'react';

export const KEYCAPS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface Props {
  readonly field: Field;
  readonly value: AnswerValue | undefined;
  /** Raw text of a number field while it is being typed, so "1." is not lost. */
  readonly text: string;
  readonly describedBy: string;
  readonly invalid: boolean;
  readonly onChange: (value: AnswerValue | undefined, text?: string) => void;
  readonly inputRef: RefObject<HTMLElement | null>;
}

export function QuestionInput({
  field,
  value,
  text,
  describedBy,
  invalid,
  onChange,
  inputRef,
}: Props) {
  const common = {
    'aria-describedby': describedBy,
    'aria-invalid': invalid || undefined,
  } as const;
  const name = `answer-${field.id}`;

  switch (field.type) {
    case 'statement':
      return null;

    case 'short_text':
    case 'email':
      return (
        <input
          {...common}
          ref={inputRef as RefObject<HTMLInputElement>}
          id={name}
          className="respond-text"
          type={field.type === 'email' ? 'email' : 'text'}
          inputMode={field.type === 'email' ? 'email' : 'text'}
          autoComplete={field.type === 'email' ? 'email' : 'off'}
          maxLength={field.type === 'short_text' ? field.maxLength : 254}
          placeholder={
            field.type === 'short_text'
              ? (field.placeholder ?? 'Type your answer')
              : 'name@example.com'
          }
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'long_text':
      return (
        <textarea
          {...common}
          ref={inputRef as RefObject<HTMLTextAreaElement>}
          id={name}
          className="respond-text respond-textarea"
          maxLength={field.maxLength}
          rows={4}
          placeholder="Type your answer"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'number':
      return (
        <input
          {...common}
          ref={inputRef as RefObject<HTMLInputElement>}
          id={name}
          className="respond-text respond-number-input"
          type="text"
          inputMode={field.integer ? 'numeric' : 'decimal'}
          autoComplete="off"
          placeholder={
            field.min !== undefined && field.max !== undefined
              ? `${String(field.min)} to ${String(field.max)}`
              : 'Type a number'
          }
          value={text}
          onChange={(event) => {
            const raw = event.target.value;
            const trimmed = raw.trim().replace(',', '.');
            const parsed =
              trimmed === '' || !/^-?\d+(\.\d+)?$/u.test(trimmed) ? undefined : Number(trimmed);
            onChange(parsed, raw);
          }}
        />
      );

    case 'date':
      return (
        <input
          {...common}
          ref={inputRef as RefObject<HTMLInputElement>}
          id={name}
          className="respond-text respond-date"
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
        />
      );

    case 'single_choice':
    case 'multi_choice': {
      const multiple = field.type === 'multi_choice';
      const selected = new Set(
        Array.isArray(value) ? value : typeof value === 'string' ? [value] : [],
      );
      return (
        <fieldset className="respond-choices" {...common}>
          <legend className="sr-only">{field.title}</legend>
          {field.options.map((option, index) => (
            <label key={option.id} className="respond-choice">
              <input
                ref={index === 0 ? (inputRef as RefObject<HTMLInputElement>) : undefined}
                type={multiple ? 'checkbox' : 'radio'}
                name={name}
                value={option.id}
                checked={selected.has(option.id)}
                onChange={(event) => {
                  if (!multiple) return onChange(option.id);
                  const next = new Set(selected);
                  if (event.target.checked) next.add(option.id);
                  else next.delete(option.id);
                  // Kept in the field's option order, so the answer does not
                  // depend on the order things were clicked.
                  const ordered = field.options.map((o) => o.id).filter((id) => next.has(id));
                  onChange(ordered.length === 0 ? undefined : ordered);
                }}
              />
              <span className="respond-keycap" aria-hidden="true">
                {KEYCAPS[index]}
              </span>
              <span className="respond-choice-label">{option.label}</span>
              <span className="respond-choice-check" aria-hidden="true">
                ✓
              </span>
            </label>
          ))}
        </fieldset>
      );
    }

    case 'yes_no':
      return (
        <fieldset className="respond-choices respond-choices-row" {...common}>
          <legend className="sr-only">{field.title}</legend>
          {[
            { key: 'Y', label: 'Yes', value: true },
            { key: 'N', label: 'No', value: false },
          ].map((choice, index) => (
            <label key={choice.key} className="respond-choice">
              <input
                ref={index === 0 ? (inputRef as RefObject<HTMLInputElement>) : undefined}
                type="radio"
                name={name}
                checked={value === choice.value}
                onChange={() => onChange(choice.value)}
              />
              <span className="respond-keycap" aria-hidden="true">
                {choice.key}
              </span>
              <span className="respond-choice-label">{choice.label}</span>
              <span className="respond-choice-check" aria-hidden="true">
                ✓
              </span>
            </label>
          ))}
        </fieldset>
      );

    case 'rating':
    case 'nps': {
      const low = field.type === 'nps' ? 0 : 1;
      const high = field.type === 'nps' ? 10 : field.scale;
      const values = Array.from({ length: high - low + 1 }, (_, i) => low + i);
      return (
        <fieldset className="respond-scale" {...common} data-type={field.type}>
          <legend className="sr-only">{field.title}</legend>
          <div className="respond-scale-row">
            {values.map((n, index) => (
              <label key={n} className="respond-scale-step">
                <input
                  ref={index === 0 ? (inputRef as RefObject<HTMLInputElement>) : undefined}
                  type="radio"
                  name={name}
                  value={n}
                  checked={value === n}
                  onChange={() => onChange(n)}
                />
                <span>{n}</span>
              </label>
            ))}
          </div>
          <p className="respond-scale-ends" aria-hidden="true">
            <span>{field.type === 'nps' ? '0 · Not at all likely' : `1 · Poor`}</span>
            <span>
              {field.type === 'nps' ? 'Extremely likely · 10' : `Excellent · ${String(high)}`}
            </span>
          </p>
        </fieldset>
      );
    }
  }
}

/** The one-line keyboard hint under a question, announced with it. */
export function keyboardHint(field: Field): string {
  switch (field.type) {
    case 'single_choice':
      return `Press ${KEYCAPS[0]}–${KEYCAPS[field.options.length - 1] ?? KEYCAPS[0]} to choose, Enter to continue.`;
    case 'multi_choice':
      return `Press ${KEYCAPS[0]}–${KEYCAPS[field.options.length - 1] ?? KEYCAPS[0]} to toggle, Enter to continue.`;
    case 'yes_no':
      return 'Press Y or N, then Enter.';
    case 'long_text':
      return 'Shift + Enter for a new line, Enter to continue.';
    case 'rating':
    case 'nps':
      return 'Use the arrow keys or click a number, then Enter.';
    case 'statement':
      return 'Press Enter to continue.';
    default:
      return 'Press Enter to continue.';
  }
}
