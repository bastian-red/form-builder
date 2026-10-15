import { z } from 'zod';

/**
 * The form definition: the JSON document a form IS (docs/SPECS.md 3).
 *
 * It is stored twice -- `forms.draft`, which the builder overwrites on every
 * keystroke, and `form_versions.definition`, an immutable snapshot cut by
 * publishing -- and both are validated with this schema at every boundary.
 *
 * **This schema checks shape, not sense.** A draft is allowed to be wrong while
 * somebody is editing it: a jump that points at a question deleted a second ago,
 * a condition on a field that has not been given options yet. Refusing to SAVE
 * that draft would lose the author's work; what is refused is PUBLISHING it, and
 * that is `analyze()` in `services/form-logic`, which returns every problem at
 * once with the field it belongs to. So nothing below cross-references fields.
 *
 * Bounds are on everything that a client controls, because the draft is written
 * by a browser on a debounce and an unbounded array is a way to make the server
 * hold a megabyte per keystroke.
 */

export const FIELD_TYPES = [
  'short_text',
  'long_text',
  'email',
  'number',
  'single_choice',
  'multi_choice',
  'rating',
  'nps',
  'date',
  'yes_no',
  'statement',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * Stable ids, never derived from titles. Renaming a question must not break a
 * condition, a results card or a CSV column, so nothing keys on what a person
 * can edit.
 */
export const fieldIdSchema = z.string().regex(/^f_[a-z0-9]{8}$/u, 'a field id');
export const optionIdSchema = z.string().regex(/^o_[a-z0-9]{8}$/u, 'an option id');

export type FieldId = z.infer<typeof fieldIdSchema>;
export type OptionId = z.infer<typeof optionIdSchema>;

export const MAX_FIELDS = 100;
export const MAX_OPTIONS = 20;
export const MAX_JUMPS = 10;
/** Nesting depth of all/any/not. Deep enough for any form a person draws, shallow enough to evaluate without a stack worry. */
export const MAX_CONDITION_DEPTH = 6;
export const MAX_CONDITION_NODES = 64;

/** A comparison operand: an option id, a number, a boolean, or text. */
export const conditionValueSchema = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
]);

export type ConditionValue = z.infer<typeof conditionValueSchema>;

export type Condition =
  | { op: 'all'; of: Condition[] }
  | { op: 'any'; of: Condition[] }
  | { op: 'not'; of: Condition }
  | { op: 'answered'; field: FieldId }
  | { op: 'eq' | 'neq'; field: FieldId; value: ConditionValue }
  | { op: 'includes'; field: FieldId; value: OptionId }
  | { op: 'gt' | 'gte' | 'lt' | 'lte'; field: FieldId; value: number };

export const COMPARISON_OPS = ['gt', 'gte', 'lt', 'lte'] as const;

const conditionShape: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('all'), of: z.array(conditionShape).max(MAX_CONDITION_NODES) }),
    z.object({ op: z.literal('any'), of: z.array(conditionShape).max(MAX_CONDITION_NODES) }),
    z.object({ op: z.literal('not'), of: conditionShape }),
    z.object({ op: z.literal('answered'), field: fieldIdSchema }),
    z.object({ op: z.literal('eq'), field: fieldIdSchema, value: conditionValueSchema }),
    z.object({ op: z.literal('neq'), field: fieldIdSchema, value: conditionValueSchema }),
    z.object({ op: z.literal('includes'), field: fieldIdSchema, value: optionIdSchema }),
    z.object({ op: z.enum(COMPARISON_OPS), field: fieldIdSchema, value: z.number().finite() }),
  ]),
);

/** Depth and node count of a condition tree, for the bounds below. */
export function conditionSize(condition: Condition): { depth: number; nodes: number } {
  switch (condition.op) {
    case 'all':
    case 'any': {
      let depth = 0;
      let nodes = 1;
      for (const child of condition.of) {
        const size = conditionSize(child);
        depth = Math.max(depth, size.depth);
        nodes += size.nodes;
      }
      return { depth: depth + 1, nodes };
    }
    case 'not': {
      const size = conditionSize(condition.of);
      return { depth: size.depth + 1, nodes: size.nodes + 1 };
    }
    default:
      return { depth: 1, nodes: 1 };
  }
}

/**
 * A condition, bounded. `z.lazy` recursion has no depth limit of its own, so a
 * hand-crafted draft nested ten thousand levels deep would be parsed (and later
 * evaluated) recursively. The bound turns that into a 400.
 */
export const conditionSchema = conditionShape.superRefine((condition, context) => {
  const { depth, nodes } = conditionSize(condition);
  if (depth > MAX_CONDITION_DEPTH) {
    context.addIssue({ code: 'custom', message: `nested deeper than ${MAX_CONDITION_DEPTH}` });
  }
  if (nodes > MAX_CONDITION_NODES) {
    context.addIssue({ code: 'custom', message: `more than ${MAX_CONDITION_NODES} rules` });
  }
});

/** After answering a field: go to `to`, or stop. First matching jump wins. */
export const jumpSchema = z.object({
  when: conditionSchema,
  to: z.union([fieldIdSchema, z.literal('end')]),
});

export type Jump = z.infer<typeof jumpSchema>;

export const optionSchema = z.object({
  id: optionIdSchema,
  label: z.string().trim().min(1).max(200),
});

export type Option = z.infer<typeof optionSchema>;

const base = {
  id: fieldIdSchema,
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(1000).optional(),
  required: z.boolean(),
  showIf: conditionSchema.optional(),
  jumps: z.array(jumpSchema).max(MAX_JUMPS).optional(),
};

const options = z.array(optionSchema).min(1).max(MAX_OPTIONS);

export const fieldSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('short_text'),
    maxLength: z.number().int().min(1).max(1000),
    placeholder: z.string().max(120).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('long_text'),
    maxLength: z.number().int().min(1).max(5000),
  }),
  z.object({ ...base, type: z.literal('email') }),
  z.object({
    ...base,
    type: z.literal('number'),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    integer: z.boolean(),
  }),
  z.object({ ...base, type: z.literal('single_choice'), options }),
  z.object({
    ...base,
    type: z.literal('multi_choice'),
    options,
    minSelected: z.number().int().min(1).max(MAX_OPTIONS).optional(),
    maxSelected: z.number().int().min(1).max(MAX_OPTIONS).optional(),
  }),
  z.object({ ...base, type: z.literal('rating'), scale: z.number().int().min(3).max(10) }),
  z.object({ ...base, type: z.literal('nps') }),
  z.object({ ...base, type: z.literal('date') }),
  z.object({ ...base, type: z.literal('yes_no') }),
  // A statement is text on a screen. It can never be answered, so it can never
  // be required; `required: false` as a literal makes the impossible state
  // unrepresentable instead of a rule somebody has to remember.
  z.object({ ...base, type: z.literal('statement'), required: z.literal(false) }),
]);

export type Field = z.infer<typeof fieldSchema>;
export type FieldOf<T extends FieldType> = Extract<Field, { type: T }>;
export type ChoiceField = FieldOf<'single_choice'> | FieldOf<'multi_choice'>;

export const endingSchema = z.object({
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().max(1000),
});

export const formDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  fields: z.array(fieldSchema).max(MAX_FIELDS),
  ending: endingSchema,
});

export type FormDefinition = z.infer<typeof formDefinitionSchema>;

/**
 * One answer as it travels: text, a number, a boolean, or a list of option ids.
 * Which of these a given field accepts is `answerSchemaFor(field)` in
 * `services/form-logic`; this is only the wire shape.
 */
export const answerValueSchema = z.union([
  z.string().max(5000),
  z.number().finite(),
  z.boolean(),
  z.array(optionIdSchema).max(MAX_OPTIONS),
]);

export type AnswerValue = z.infer<typeof answerValueSchema>;

/**
 * Answers keyed by field id. Keys are validated as ids here; whether each key
 * names a field of THIS form, is on the respondent's path and holds the right
 * type is the logic engine's job, on the server, every time.
 */
export const answersSchema = z
  .record(fieldIdSchema, answerValueSchema)
  .refine((answers) => Object.keys(answers).length <= MAX_FIELDS, `at most ${MAX_FIELDS} answers`);

export type Answers = z.infer<typeof answersSchema>;

/** The definition a new form starts from. */
export function emptyDefinition(title: string): FormDefinition {
  return {
    schemaVersion: 1,
    title,
    fields: [],
    ending: { title: 'Thank you', message: 'Your answers have been recorded.' },
  };
}

/** Whether a field type collects an answer at all. */
export function isAnswerable(field: Pick<Field, 'type'>): boolean {
  return field.type !== 'statement';
}

export function isChoiceField(field: Field): field is ChoiceField {
  return field.type === 'single_choice' || field.type === 'multi_choice';
}
