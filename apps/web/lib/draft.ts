/**
 * Draft editing: every change the builder makes to a form definition, as a pure
 * function from one definition to the next.
 *
 * Pure so they are unit tested here and the builder component only wires them
 * to events. None of them repairs logic the author broke (deleting a question
 * that a rule reads, moving a question below its own jump target): the analyzer
 * reports exactly that, on the block, in a sentence, and silently rewriting
 * somebody's rules is worse than showing them.
 */
import type {
  Condition,
  ConditionValue,
  Field,
  FieldId,
  FieldType,
  FormDefinition,
  Jump,
  Option,
} from '@forms/shared';
import { isAnswerable, isChoiceField, newFieldId, newOptionId } from '@forms/shared';

/** What each type is called in the builder, and the glyph its block carries. */
export const FIELD_TYPE_META: ReadonlyArray<{
  type: FieldType;
  label: string;
  glyph: string;
  hint: string;
}> = [
  { type: 'short_text', label: 'Short text', glyph: 'Aa', hint: 'A name, a company, one line' },
  { type: 'long_text', label: 'Long text', glyph: '¶', hint: 'A paragraph of feedback' },
  { type: 'email', label: 'Email', glyph: '@', hint: 'Checked for a valid address' },
  { type: 'number', label: 'Number', glyph: '#', hint: 'With an optional range' },
  { type: 'single_choice', label: 'Single choice', glyph: '◉', hint: 'Pick one option' },
  { type: 'multi_choice', label: 'Multiple choice', glyph: '☑', hint: 'Pick any number' },
  { type: 'rating', label: 'Rating', glyph: '★', hint: 'A scale from 1 to N' },
  { type: 'nps', label: 'Net Promoter Score', glyph: '0–10', hint: 'How likely to recommend' },
  { type: 'date', label: 'Date', glyph: '▦', hint: 'A calendar date' },
  { type: 'yes_no', label: 'Yes / No', glyph: 'Y/N', hint: 'A single yes or no' },
  { type: 'statement', label: 'Statement', glyph: '❝', hint: 'Text only, no answer' },
];

export function typeMeta(type: FieldType): { label: string; glyph: string } {
  return FIELD_TYPE_META.find((meta) => meta.type === type) ?? { label: type, glyph: '?' };
}

/** A new question of a type, with sensible defaults and fresh ids. */
export function newField(type: FieldType, random?: (length: number) => Uint8Array): Field {
  const id = newFieldId(random);
  const base = {
    id,
    title: type === 'statement' ? 'A note for the respondent' : 'Untitled question',
    required: false,
  };
  const option = (label: string): Option => ({ id: newOptionId(random), label });
  switch (type) {
    case 'short_text':
      return { ...base, type, maxLength: 200 };
    case 'long_text':
      return { ...base, type, maxLength: 5000 };
    case 'number':
      return { ...base, type, integer: false };
    case 'single_choice':
    case 'multi_choice':
      return { ...base, type, options: [option('Option 1'), option('Option 2')] };
    case 'rating':
      return { ...base, type, scale: 5 };
    case 'statement':
      return { ...base, type, required: false };
    case 'email':
    case 'nps':
    case 'date':
    case 'yes_no':
      return { ...base, type };
  }
}

export function insertField(definition: FormDefinition, at: number, field: Field): FormDefinition {
  const fields = [...definition.fields];
  fields.splice(Math.max(0, Math.min(at, fields.length)), 0, field);
  return { ...definition, fields };
}

export function removeField(definition: FormDefinition, id: FieldId): FormDefinition {
  return { ...definition, fields: definition.fields.filter((field) => field.id !== id) };
}

export function moveField(definition: FormDefinition, from: number, to: number): FormDefinition {
  if (from === to || from < 0 || from >= definition.fields.length) return definition;
  const fields = [...definition.fields];
  const [moved] = fields.splice(from, 1);
  fields.splice(Math.max(0, Math.min(to, fields.length)), 0, moved!);
  return { ...definition, fields };
}

/** Replace one field. The id is the identity and cannot be patched. */
export function updateField(
  definition: FormDefinition,
  id: FieldId,
  next: (field: Field) => Field,
): FormDefinition {
  return {
    ...definition,
    fields: definition.fields.map((field) => (field.id === id ? { ...next(field), id } : field)),
  };
}

/**
 * Change a question's type, keeping what carries over (title, description,
 * required, logic) and resetting what does not. Options survive a switch between
 * single and multiple choice, because that is the change people actually make.
 */
export function changeType(field: Field, type: FieldType): Field {
  if (field.type === type) return field;
  const fresh = newField(type);
  const kept = {
    id: field.id,
    title: field.title,
    ...(field.description === undefined ? {} : { description: field.description }),
    ...(field.showIf === undefined ? {} : { showIf: field.showIf }),
    ...(field.jumps === undefined ? {} : { jumps: field.jumps }),
  };
  if (type === 'statement') return { ...fresh, ...kept, required: false } as Field;
  const merged = { ...fresh, ...kept, required: field.required } as Field;
  if (isChoiceField(field) && isChoiceField(merged)) return { ...merged, options: field.options };
  return merged;
}

export function duplicateField(
  definition: FormDefinition,
  id: FieldId,
): { definition: FormDefinition; copyId: FieldId | null } {
  const at = definition.fields.findIndex((field) => field.id === id);
  if (at === -1) return { definition, copyId: null };
  const source = definition.fields[at]!;
  const copy: Field = {
    ...source,
    id: newFieldId(),
    title: `${source.title} (copy)`.slice(0, 300),
    ...(isChoiceField(source)
      ? { options: source.options.map((option) => ({ ...option, id: newOptionId() })) }
      : {}),
  } as Field;
  // The copy's own jumps would point to the same targets and duplicate the
  // branching; drop them, keep the visibility rule.
  delete (copy as { jumps?: Jump[] }).jumps;
  return { definition: insertField(definition, at + 1, copy), copyId: copy.id };
}

// --- Conditions as the builder edits them --------------------------------------

/** A single comparison: what the logic editor's one row edits. */
export type Rule =
  Exclude<Condition, { op: 'all' | 'any' | 'not' }> | { op: 'skipped'; field: FieldId };

export interface RuleSet {
  readonly match: 'all' | 'any';
  readonly rules: readonly Rule[];
}

/**
 * A condition as a flat rule list, or null when it is nested deeper than the
 * editor draws (possible only from a hand-edited draft). `not(answered(x))` is
 * shown as the rule "x is skipped".
 */
export function toRuleSet(condition: Condition | undefined): RuleSet | null {
  if (condition === undefined) return { match: 'all', rules: [] };
  const leaf = (item: Condition): Rule | null => {
    if (item.op === 'not')
      return item.of.op === 'answered' ? { op: 'skipped', field: item.of.field } : null;
    if (item.op === 'all' || item.op === 'any') return null;
    return item;
  };
  if (condition.op === 'all' || condition.op === 'any') {
    const rules = condition.of.map(leaf);
    return rules.every((rule): rule is Rule => rule !== null)
      ? { match: condition.op, rules }
      : null;
  }
  const single = leaf(condition);
  return single === null ? null : { match: 'all', rules: [single] };
}

export function fromRule(rule: Rule): Condition {
  return rule.op === 'skipped' ? { op: 'not', of: { op: 'answered', field: rule.field } } : rule;
}

/** A rule set back to a condition; an empty set means "no condition". */
export function fromRuleSet(set: RuleSet): Condition | undefined {
  if (set.rules.length === 0) return undefined;
  if (set.rules.length === 1) return fromRule(set.rules[0]!);
  return { op: set.match, of: set.rules.map(fromRule) };
}

export interface OperatorChoice {
  readonly op: Rule['op'];
  readonly label: string;
  /** What the value control is: an option list, a number, yes/no, text, or none. */
  readonly value: 'option' | 'number' | 'boolean' | 'text' | 'none';
}

/** The comparisons that make sense for a question of this type, in the order offered. */
export function operatorsFor(field: Field): OperatorChoice[] {
  const presence: OperatorChoice[] = [
    { op: 'answered', label: 'is answered', value: 'none' },
    { op: 'skipped', label: 'is skipped', value: 'none' },
  ];
  switch (field.type) {
    case 'single_choice':
      return [
        { op: 'eq', label: 'is', value: 'option' },
        { op: 'neq', label: 'is not', value: 'option' },
        ...presence,
      ];
    case 'multi_choice':
      return [{ op: 'includes', label: 'includes', value: 'option' }, ...presence];
    case 'yes_no':
      return [{ op: 'eq', label: 'is', value: 'boolean' }, ...presence];
    case 'number':
    case 'rating':
    case 'nps':
      return [
        { op: 'eq', label: 'is', value: 'number' },
        { op: 'neq', label: 'is not', value: 'number' },
        { op: 'lt', label: 'is less than', value: 'number' },
        { op: 'lte', label: 'is at most', value: 'number' },
        { op: 'gt', label: 'is more than', value: 'number' },
        { op: 'gte', label: 'is at least', value: 'number' },
        ...presence,
      ];
    case 'short_text':
    case 'long_text':
    case 'email':
    case 'date':
      return [
        { op: 'eq', label: 'is', value: 'text' },
        { op: 'neq', label: 'is not', value: 'text' },
        ...presence,
      ];
    case 'statement':
      return [];
  }
}

/** A starting value for an operator on a field, so a new rule is valid as soon as it exists. */
export function defaultValue(
  field: Field,
  kind: OperatorChoice['value'],
): ConditionValue | undefined {
  switch (kind) {
    case 'option':
      return isChoiceField(field) ? field.options[0]?.id : undefined;
    case 'number':
      return field.type === 'rating' ? Math.ceil(field.scale / 2) : field.type === 'nps' ? 7 : 0;
    case 'boolean':
      return true;
    case 'text':
      return '';
    case 'none':
      return undefined;
  }
}

/** A rule for `field` with `op`, carrying a value of the right kind. */
export function makeRule(field: Field, op: Rule['op']): Rule {
  const choice =
    operatorsFor(field).find((candidate) => candidate.op === op) ?? operatorsFor(field)[0]!;
  if (choice.op === 'answered' || choice.op === 'skipped')
    return { op: choice.op, field: field.id };
  const value = defaultValue(field, choice.value);
  if (choice.op === 'includes')
    return { op: 'includes', field: field.id, value: String(value ?? '') };
  if (choice.op === 'gt' || choice.op === 'gte' || choice.op === 'lt' || choice.op === 'lte') {
    return { op: choice.op, field: field.id, value: typeof value === 'number' ? value : 0 };
  }
  return { op: choice.op, field: field.id, value: value ?? '' };
}

/**
 * The questions a rule on the field at `position` may read: answerable ones
 * before it, and for a jump (which runs after the question) the question itself.
 */
export function readableFields(
  definition: FormDefinition,
  position: number,
  includeSelf: boolean,
): Field[] {
  return definition.fields.filter(
    (field, at) => isAnswerable(field) && (at < position || (includeSelf && at === position)),
  );
}

/** Where a jump from `position` may go: any later question, or the end. */
export function jumpTargets(definition: FormDefinition, position: number): Field[] {
  return definition.fields.slice(position + 1);
}
