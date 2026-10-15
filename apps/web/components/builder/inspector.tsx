'use client';

/**
 * The inspector: everything about the selected question, and the logic in
 * sentences you build from menus.
 *
 * It edits by calling `onChange(nextField)`; the builder owns the definition and
 * the autosave. Nothing here validates: an empty title or an inverted range is
 * saved as a draft and reported by the analyzer on the block, because refusing
 * a keystroke is worse than showing what is wrong with it.
 */
import {
  isChoiceField,
  newOptionId,
  type Field,
  type FieldType,
  type FormDefinition,
  type Jump,
} from '@forms/shared';
import { useId } from 'react';

import {
  FIELD_TYPE_META,
  changeType,
  fromRule,
  fromRuleSet,
  jumpTargets,
  makeRule,
  readableFields,
  toRuleSet,
  type Rule,
  type RuleSet,
} from '../../lib/draft';
import { RuleEditor } from './rule-editor';

interface Props {
  readonly field: Field;
  readonly position: number;
  readonly definition: FormDefinition;
  readonly onChange: (next: Field) => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly onInsertBelow: () => void;
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="field-input"
        type="number"
        min={min}
        max={max}
        value={value ?? ''}
        onChange={(event) => {
          if (event.target.value === '') return onChange(undefined);
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
      />
    </label>
  );
}

export function Inspector({
  field,
  position,
  definition,
  onChange,
  onDuplicate,
  onDelete,
  onInsertBelow,
}: Props) {
  const id = useId();
  const visibility = toRuleSet(field.showIf);
  const showReadable = readableFields(definition, position, false);
  const jumpReadable = readableFields(definition, position, true);
  const targets = jumpTargets(definition, position);

  const setVisibility = (set: RuleSet) => {
    const next = { ...field } as Field;
    const condition = fromRuleSet(set);
    if (condition === undefined) delete (next as { showIf?: unknown }).showIf;
    else next.showIf = condition;
    onChange(next);
  };

  const setJumps = (jumps: Jump[]) => {
    const next = { ...field } as Field;
    if (jumps.length === 0) delete (next as { jumps?: unknown }).jumps;
    else next.jumps = jumps;
    onChange(next);
  };

  return (
    <div className="inspector" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="inspector-title">
        Question <span className="mono">{position + 1}</span>
        <span className="inspector-id mono">{field.id}</span>
      </h2>

      <section className="inspector-section" aria-label="The question">
        <label className="field">
          <span className="field-label">Type</span>
          <select
            className="field-input"
            value={field.type}
            onChange={(event) => onChange(changeType(field, event.target.value as FieldType))}
          >
            {FIELD_TYPE_META.map((meta) => (
              <option key={meta.type} value={meta.type}>
                {meta.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{field.type === 'statement' ? 'Text' : 'Question'}</span>
          <textarea
            className="field-input inspector-question"
            rows={2}
            maxLength={300}
            value={field.title}
            onChange={(event) => onChange({ ...field, title: event.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">Description</span>
          <span className="field-hint">Shown under the question. Optional.</span>
          <textarea
            className="field-input"
            rows={2}
            maxLength={1000}
            value={field.description ?? ''}
            onChange={(event) => {
              const next = { ...field };
              if (event.target.value === '') delete next.description;
              else next.description = event.target.value;
              onChange(next);
            }}
          />
        </label>
        {field.type === 'statement' ? null : (
          <label className="check">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(event) => onChange({ ...field, required: event.target.checked } as Field)}
            />
            Required
          </label>
        )}
      </section>

      <TypeSettings field={field} onChange={onChange} />

      <section className="inspector-section" aria-labelledby={`${id}-visibility`}>
        <h3 id={`${id}-visibility`} className="inspector-heading">
          <span aria-hidden="true">◇ </span>Visibility
        </h3>
        {visibility === null ? (
          <p className="field-hint">
            This rule is nested deeper than the editor can show. Reset it to edit.
          </p>
        ) : showReadable.length === 0 ? (
          <p className="field-hint">
            Always shown. Questions above this one can be used to hide it.
          </p>
        ) : (
          <>
            <fieldset className="inspector-choice">
              <legend className="sr-only">When is this question shown?</legend>
              <label className="check">
                <input
                  type="radio"
                  name={`${id}-shown`}
                  checked={visibility.rules.length === 0}
                  onChange={() => setVisibility({ match: 'all', rules: [] })}
                />
                Always shown
              </label>
              <label className="check">
                <input
                  type="radio"
                  name={`${id}-shown`}
                  checked={visibility.rules.length > 0}
                  onChange={() =>
                    setVisibility({
                      match: 'all',
                      rules: [makeRule(showReadable.at(-1)!, 'answered')],
                    })
                  }
                />
                Only when…
              </label>
            </fieldset>
            {visibility.rules.length > 1 ? (
              <label className="field inspector-match">
                <span className="field-label">Match</span>
                <select
                  className="field-input"
                  value={visibility.match}
                  onChange={(event) =>
                    setVisibility({ ...visibility, match: event.target.value as 'all' | 'any' })
                  }
                >
                  <option value="all">all of these</option>
                  <option value="any">any of these</option>
                </select>
              </label>
            ) : null}
            {visibility.rules.map((rule, index) => (
              <RuleEditor
                key={index}
                rule={rule}
                readable={showReadable}
                labelPrefix={`Visibility rule ${String(index + 1)}`}
                onChange={(next) =>
                  setVisibility({
                    ...visibility,
                    rules: visibility.rules.map((r, i) => (i === index ? next : r)),
                  })
                }
                onRemove={() =>
                  setVisibility({
                    ...visibility,
                    rules: visibility.rules.filter((_, i) => i !== index),
                  })
                }
              />
            ))}
            {visibility.rules.length > 0 ? (
              <button
                className="button button-quiet"
                type="button"
                onClick={() =>
                  setVisibility({
                    ...visibility,
                    rules: [...visibility.rules, makeRule(showReadable.at(-1)!, 'answered')],
                  })
                }
              >
                <span aria-hidden="true">+</span> Add a rule
              </button>
            ) : null}
          </>
        )}
      </section>

      <section className="inspector-section" aria-labelledby={`${id}-jumps`}>
        <h3 id={`${id}-jumps`} className="inspector-heading">
          <span aria-hidden="true">↳ </span>After this question
        </h3>
        <p className="field-hint">
          Jumps are checked in order; the first that matches wins. Jumps only go forward.
        </p>
        {(field.jumps ?? []).map((jump, index) => {
          const rules = toRuleSet(jump.when);
          const always = jump.when.op === 'all' && jump.when.of.length === 0;
          const rule = rules?.rules[0];
          return (
            <div key={index} className="jump">
              <label className="field">
                <span className="field-label">Jump {index + 1}: when</span>
                <select
                  className="field-input"
                  value={always ? 'always' : 'rule'}
                  onChange={(event) =>
                    setJumps(
                      (field.jumps ?? []).map((j, i) =>
                        i !== index
                          ? j
                          : {
                              ...j,
                              when:
                                event.target.value === 'always'
                                  ? { op: 'all', of: [] }
                                  : fromRule(makeRule(jumpReadable.at(-1)!, 'answered')),
                            },
                      ),
                    )
                  }
                >
                  <option value="rule">a rule matches</option>
                  <option value="always">always</option>
                </select>
              </label>
              {!always && rule !== undefined && rules?.rules.length === 1 ? (
                <RuleEditor
                  rule={rule}
                  readable={jumpReadable}
                  labelPrefix={`Jump ${String(index + 1)} rule`}
                  onChange={(next: Rule) =>
                    setJumps(
                      (field.jumps ?? []).map((j, i) =>
                        i === index ? { ...j, when: fromRule(next) } : j,
                      ),
                    )
                  }
                />
              ) : null}
              <label className="field">
                <span className="field-label">go to</span>
                <select
                  className="field-input"
                  value={jump.to}
                  onChange={(event) =>
                    setJumps(
                      (field.jumps ?? []).map((j, i) =>
                        i === index ? { ...j, to: event.target.value } : j,
                      ),
                    )
                  }
                >
                  {jump.to !== 'end' && !targets.some((target) => target.id === jump.to) ? (
                    <option value={jump.to}>A question that is not below this one</option>
                  ) : null}
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {definition.fields.indexOf(target) + 1}. {target.title}
                    </option>
                  ))}
                  <option value="end">The end of the form</option>
                </select>
              </label>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => setJumps((field.jumps ?? []).filter((_, i) => i !== index))}
              >
                <span aria-hidden="true">✕</span> Remove jump {index + 1}
              </button>
            </div>
          );
        })}
        {field.type === 'statement' && jumpReadable.length === 0 ? null : (
          <button
            className="button"
            type="button"
            disabled={(field.jumps?.length ?? 0) >= 10}
            onClick={() =>
              setJumps([
                ...(field.jumps ?? []),
                {
                  when:
                    jumpReadable.length > 0
                      ? fromRule(makeRule(jumpReadable.at(-1)!, 'answered'))
                      : { op: 'all', of: [] },
                  to: targets[0]?.id ?? 'end',
                },
              ])
            }
          >
            <span aria-hidden="true">+</span> Add a jump
          </button>
        )}
      </section>

      <section className="inspector-section inspector-actions" aria-label="Question actions">
        <button className="button" type="button" onClick={onInsertBelow}>
          <span aria-hidden="true">+</span> Insert below
        </button>
        <button className="button" type="button" onClick={onDuplicate}>
          Duplicate
        </button>
        <button className="button button-danger" type="button" onClick={onDelete}>
          Delete question
        </button>
      </section>
    </div>
  );
}

function TypeSettings({
  field,
  onChange,
}: {
  readonly field: Field;
  readonly onChange: (next: Field) => void;
}) {
  if (isChoiceField(field)) {
    const options = field.options;
    return (
      <section className="inspector-section" aria-label="Options">
        <h3 className="inspector-heading">Options</h3>
        <ol className="options">
          {options.map((option, index) => (
            <li key={option.id} className="option-row">
              <span className="option-key mono" aria-hidden="true">
                {String.fromCharCode(65 + index)}
              </span>
              <input
                className="field-input"
                aria-label={`Option ${String(index + 1)}`}
                maxLength={200}
                value={option.label}
                onChange={(event) =>
                  onChange({
                    ...field,
                    options: options.map((o) =>
                      o.id === option.id ? { ...o, label: event.target.value } : o,
                    ),
                  })
                }
              />
              <button
                className="button button-quiet"
                type="button"
                disabled={index === 0}
                aria-label={`Move option ${String(index + 1)} up`}
                onClick={() => {
                  const next = [...options];
                  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                  onChange({ ...field, options: next });
                }}
              >
                <span aria-hidden="true">↑</span>
              </button>
              <button
                className="button button-quiet"
                type="button"
                disabled={options.length <= 1}
                aria-label={`Remove option ${String(index + 1)}`}
                onClick={() =>
                  onChange({ ...field, options: options.filter((o) => o.id !== option.id) })
                }
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ol>
        <button
          className="button"
          type="button"
          disabled={options.length >= 20}
          onClick={() =>
            onChange({
              ...field,
              options: [
                ...options,
                { id: newOptionId(), label: `Option ${String(options.length + 1)}` },
              ],
            })
          }
        >
          <span aria-hidden="true">+</span> Add an option
        </button>
        {field.type === 'multi_choice' ? (
          <div className="inspector-pair">
            <NumberInput
              label="At least"
              min={1}
              max={20}
              value={field.minSelected}
              onChange={(value) => {
                const next = { ...field };
                if (value === undefined) delete next.minSelected;
                else next.minSelected = value;
                onChange(next);
              }}
            />
            <NumberInput
              label="At most"
              min={1}
              max={20}
              value={field.maxSelected}
              onChange={(value) => {
                const next = { ...field };
                if (value === undefined) delete next.maxSelected;
                else next.maxSelected = value;
                onChange(next);
              }}
            />
          </div>
        ) : null}
      </section>
    );
  }
  switch (field.type) {
    case 'number':
      return (
        <section className="inspector-section" aria-label="Number settings">
          <div className="inspector-pair">
            <NumberInput
              label="Minimum"
              value={field.min}
              onChange={(value) => {
                const next = { ...field };
                if (value === undefined) delete next.min;
                else next.min = value;
                onChange(next);
              }}
            />
            <NumberInput
              label="Maximum"
              value={field.max}
              onChange={(value) => {
                const next = { ...field };
                if (value === undefined) delete next.max;
                else next.max = value;
                onChange(next);
              }}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={field.integer}
              onChange={(event) => onChange({ ...field, integer: event.target.checked })}
            />
            Whole numbers only
          </label>
        </section>
      );
    case 'rating':
      return (
        <section className="inspector-section" aria-label="Rating settings">
          <NumberInput
            label="Scale (3 to 10)"
            min={3}
            max={10}
            value={field.scale}
            onChange={(value) =>
              onChange({ ...field, scale: Math.min(10, Math.max(3, Math.round(value ?? 5))) })
            }
          />
        </section>
      );
    case 'short_text':
    case 'long_text':
      return (
        <section className="inspector-section" aria-label="Text settings">
          <NumberInput
            label="Maximum length"
            min={1}
            max={field.type === 'short_text' ? 1000 : 5000}
            value={field.maxLength}
            onChange={(value) =>
              onChange({ ...field, maxLength: Math.max(1, Math.round(value ?? 1)) })
            }
          />
        </section>
      );
    default:
      return null;
  }
}
