/**
 * Conditions as sentences: "Role is Manager and Team size is more than 5".
 *
 * The builder shows logic as text under each block and on each connector, and
 * the analyzer's messages quote it. One function so the sentence a person reads
 * in the gutter is the sentence in the error.
 *
 * A reference to a field that no longer exists reads as "a deleted question"
 * rather than an id: an author does not know what `f_k2m9x0qa` was.
 */
import type { Condition, ConditionValue, Field, FieldId, FormDefinition } from '@forms/shared';

const MAX_TITLE = 40;

export function shortTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length <= MAX_TITLE ? trimmed : `${trimmed.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}

/** "question 3" style label, 1-based, used where a title would be ambiguous. */
export function positionLabel(definition: FormDefinition, id: FieldId): string {
  const position = definition.fields.findIndex((field) => field.id === id);
  return position === -1 ? 'a deleted question' : `question ${String(position + 1)}`;
}

function fieldName(fields: ReadonlyMap<FieldId, Field>, id: FieldId): string {
  const field = fields.get(id);
  return field === undefined ? 'a deleted question' : `“${shortTitle(field.title)}”`;
}

function valueName(field: Field | undefined, value: ConditionValue): string {
  if (field !== undefined && (field.type === 'single_choice' || field.type === 'multi_choice')) {
    const option = field.options.find((candidate) => candidate.id === value);
    return option === undefined ? 'a deleted option' : `“${shortTitle(option.label)}”`;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  return `“${shortTitle(value)}”`;
}

const COMPARE: Record<'gt' | 'gte' | 'lt' | 'lte', string> = {
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
};

function describeIn(
  condition: Condition,
  fields: ReadonlyMap<FieldId, Field>,
  nested: boolean,
): string {
  switch (condition.op) {
    case 'all':
    case 'any': {
      if (condition.of.length === 0) return condition.op === 'all' ? 'always' : 'never';
      const joiner = condition.op === 'all' ? ' and ' : ' or ';
      const text = condition.of.map((child) => describeIn(child, fields, true)).join(joiner);
      return nested && condition.of.length > 1 ? `(${text})` : text;
    }
    case 'not':
      if (condition.of.op === 'answered')
        return `${fieldName(fields, condition.of.field)} is skipped`;
      return `not ${describeIn(condition.of, fields, true)}`;
    case 'answered':
      return `${fieldName(fields, condition.field)} is answered`;
    case 'eq':
      return `${fieldName(fields, condition.field)} is ${valueName(fields.get(condition.field), condition.value)}`;
    case 'neq':
      return `${fieldName(fields, condition.field)} is not ${valueName(fields.get(condition.field), condition.value)}`;
    case 'includes':
      return `${fieldName(fields, condition.field)} includes ${valueName(fields.get(condition.field), condition.value)}`;
    default:
      return `${fieldName(fields, condition.field)} ${COMPARE[condition.op]} ${String(condition.value)}`;
  }
}

export function describeCondition(condition: Condition, definition: FormDefinition): string {
  const fields = new Map(definition.fields.map((field) => [field.id, field] as const));
  return describeIn(condition, fields, false);
}
