'use client';

/**
 * One logic rule, edited as a sentence: [question] [comparison] [value].
 *
 * Only comparisons the analyzer accepts for the chosen question are offered
 * (`operatorsFor`), and switching the question resets the rule to a valid
 * default for its type, so the editor cannot build a type mismatch. What it can
 * build -- a rule on a question that is later moved below this one -- is the
 * analyzer's to report.
 */
import { isChoiceField, type Field, type FieldId } from '@forms/shared';

import { makeRule, operatorsFor, type Rule } from '../../lib/draft';

interface Props {
  readonly rule: Rule;
  readonly readable: readonly Field[];
  readonly labelPrefix: string;
  readonly onChange: (rule: Rule) => void;
  readonly onRemove?: () => void;
}

function valueOf(rule: Rule): unknown {
  return 'value' in rule ? rule.value : undefined;
}

export function RuleEditor({ rule, readable, labelPrefix, onChange, onRemove }: Props) {
  const target = readable.find((field) => field.id === rule.field);
  const operators = target === undefined ? [] : operatorsFor(target);
  const operator = operators.find((choice) => choice.op === rule.op);
  const value = valueOf(rule);

  return (
    <div className="rule">
      <select
        className="field-input rule-field"
        aria-label={`${labelPrefix}: question`}
        value={target === undefined ? '' : rule.field}
        onChange={(event) => {
          const next = readable.find((field) => field.id === (event.target.value as FieldId));
          if (next) onChange(makeRule(next, operatorsFor(next)[0]!.op));
        }}
      >
        {target === undefined ? <option value="">A deleted question</option> : null}
        {readable.map((field) => (
          <option key={field.id} value={field.id}>
            {field.title}
          </option>
        ))}
      </select>
      {target === undefined ? null : (
        <select
          className="field-input rule-op"
          aria-label={`${labelPrefix}: comparison`}
          value={rule.op}
          onChange={(event) => onChange(makeRule(target, event.target.value as Rule['op']))}
        >
          {operators.map((choice) => (
            <option key={choice.op} value={choice.op}>
              {choice.label}
            </option>
          ))}
        </select>
      )}
      {target !== undefined && operator?.value === 'option' && isChoiceField(target) ? (
        <select
          className="field-input rule-value"
          aria-label={`${labelPrefix}: option`}
          value={String(value ?? '')}
          onChange={(event) => onChange({ ...rule, value: event.target.value } as Rule)}
        >
          {target.options.some((option) => option.id === value) ? null : (
            <option value={String(value ?? '')}>A deleted option</option>
          )}
          {target.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
      {operator?.value === 'boolean' ? (
        <select
          className="field-input rule-value"
          aria-label={`${labelPrefix}: answer`}
          value={value === false ? 'false' : 'true'}
          onChange={(event) => onChange({ ...rule, value: event.target.value === 'true' } as Rule)}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : null}
      {operator?.value === 'number' ? (
        <input
          className="field-input rule-value rule-number"
          aria-label={`${labelPrefix}: number`}
          type="number"
          value={typeof value === 'number' ? value : 0}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (event.target.value !== '' && Number.isFinite(parsed))
              onChange({ ...rule, value: parsed } as Rule);
          }}
        />
      ) : null}
      {operator?.value === 'text' ? (
        <input
          className="field-input rule-value"
          aria-label={`${labelPrefix}: text`}
          type="text"
          maxLength={200}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange({ ...rule, value: event.target.value } as Rule)}
        />
      ) : null}
      {onRemove === undefined ? null : (
        <button
          className="button button-quiet rule-remove"
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${labelPrefix.toLowerCase()}`}
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}
