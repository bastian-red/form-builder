/**
 * The publish-time analyzer (docs/SPECS.md 4).
 *
 * A draft may be wrong while it is being edited; a PUBLISHED version may not.
 * This returns every problem at once, each attached to the block it is drawn on
 * (`fieldId`) and, for an edge, the other end (`ref`), so the builder can draw a
 * broken connector between the two and the API can refuse a publish with the
 * same list.
 *
 * Errors block publishing. The one warning (`unreachable`) does not: a question
 * nobody can reach is wasted, not dangerous.
 *
 * Why the logic graph cannot loop: every jump must target a field strictly
 * after its source (`backward_jump` otherwise), and a condition may only read
 * fields before the one it guards (`forward_ref` otherwise). With both, the
 * path is a walk along increasing indexes and a cycle is not expressible.
 */
import type {
  AnalyzerIssue,
  Condition,
  Field,
  FieldId,
  FormDefinition,
  IssueCode,
} from '@forms/shared';
import { isAnswerable, isChoiceField } from '@forms/shared';

import { describeCondition, shortTitle } from './describe';
import { isAlways } from './evaluate';

type Severity = AnalyzerIssue['severity'];

function issue(
  severity: Severity,
  code: IssueCode,
  fieldId: FieldId | null,
  ref: string | null,
  message: string,
): AnalyzerIssue {
  return { severity, code, fieldId, ref, message };
}

/** "Question 3 (“What is your role?”)" */
function label(position: number, field: Field): string {
  return `Question ${String(position + 1)} (“${shortTitle(field.title)}”)`;
}

/** Every leaf comparison in a condition tree. */
function leaves(condition: Condition): Array<Exclude<Condition, { op: 'all' | 'any' | 'not' }>> {
  switch (condition.op) {
    case 'all':
    case 'any':
      return condition.of.flatMap(leaves);
    case 'not':
      return leaves(condition.of);
    default:
      return [condition];
  }
}

/**
 * Whether a leaf's operator and operand make sense for the field it reads, or
 * the sentence explaining why not.
 */
function typeProblem(
  leaf: Exclude<Condition, { op: 'all' | 'any' | 'not' }>,
  target: Field,
): string | null {
  if (leaf.op === 'answered') return null;

  if (leaf.op === 'includes') {
    if (!isChoiceField(target)) return 'only a choice question can be asked what it includes';
    return target.options.some((option) => option.id === leaf.value)
      ? null
      : 'it names an option that question does not have';
  }

  if (leaf.op === 'gt' || leaf.op === 'gte' || leaf.op === 'lt' || leaf.op === 'lte') {
    return target.type === 'number' || target.type === 'rating' || target.type === 'nps'
      ? null
      : 'only a number, rating or NPS question can be compared as more or less';
  }

  // eq / neq: the operand must be the kind of value the field holds.
  switch (target.type) {
    case 'single_choice':
      return typeof leaf.value === 'string' &&
        target.options.some((option) => option.id === leaf.value)
        ? null
        : 'it names an option that question does not have';
    case 'multi_choice':
      return 'a multiple-choice question is asked what it includes, not what it equals';
    case 'yes_no':
      return typeof leaf.value === 'boolean'
        ? null
        : 'a yes/no question is compared with Yes or No';
    case 'number':
    case 'rating':
    case 'nps':
      return typeof leaf.value === 'number' ? null : 'that question holds a number';
    case 'short_text':
    case 'long_text':
    case 'email':
    case 'date':
      return typeof leaf.value === 'string' ? null : 'that question holds text';
    case 'statement':
      return null; // reported separately as statement_condition
  }
}

export function analyze(definition: FormDefinition): AnalyzerIssue[] {
  const issues: AnalyzerIssue[] = [];
  const { fields } = definition;

  if (!fields.some(isAnswerable)) {
    issues.push(
      issue('error', 'no_fields', null, null, 'Add at least one question that can be answered.'),
    );
  }

  // --- Ids --------------------------------------------------------------------
  const position = new Map<FieldId, number>();
  fields.forEach((field, at) => {
    if (position.has(field.id)) {
      issues.push(
        issue(
          'error',
          'duplicate_id',
          field.id,
          null,
          `${label(at, field)} has the same id as another question.`,
        ),
      );
    } else {
      position.set(field.id, at);
    }
  });

  // --- Per-field constraints ----------------------------------------------------
  fields.forEach((field, at) => {
    if (isChoiceField(field)) {
      if (field.options.length < 2) {
        issues.push(
          issue(
            'error',
            'too_few_options',
            field.id,
            null,
            `${label(at, field)} needs at least two options.`,
          ),
        );
      }
      const ids = new Set<string>();
      const labels = new Set<string>();
      for (const option of field.options) {
        const key = option.label.trim().toLowerCase();
        if (ids.has(option.id) || labels.has(key)) {
          issues.push(
            issue(
              'error',
              'duplicate_option',
              field.id,
              option.id,
              `${label(at, field)} lists “${shortTitle(option.label)}” twice.`,
            ),
          );
        }
        ids.add(option.id);
        labels.add(key);
      }
    }
    if (
      field.type === 'number' &&
      field.min !== undefined &&
      field.max !== undefined &&
      field.min > field.max
    ) {
      issues.push(
        issue(
          'error',
          'invalid_bounds',
          field.id,
          null,
          `${label(at, field)} has a minimum above its maximum.`,
        ),
      );
    }
    if (field.type === 'multi_choice') {
      const { minSelected, maxSelected } = field;
      if (minSelected !== undefined && maxSelected !== undefined && minSelected > maxSelected) {
        issues.push(
          issue(
            'error',
            'invalid_bounds',
            field.id,
            null,
            `${label(at, field)} sets a minimum number of choices above its maximum.`,
          ),
        );
      }
      if (minSelected !== undefined && minSelected > field.options.length) {
        issues.push(
          issue(
            'error',
            'invalid_bounds',
            field.id,
            null,
            `${label(at, field)} asks for more choices than it has options.`,
          ),
        );
      }
    }
  });

  // --- Conditions and jumps -------------------------------------------------------
  /**
   * `limit` is the last position a condition here may read. A visibility rule
   * runs BEFORE its own question is answered, so it may read only earlier ones
   * (`at - 1`). A jump runs AFTER, so it may read its own question too (`at`).
   */
  const checkCondition = (
    condition: Condition,
    at: number,
    field: Field,
    limit: number,
    what: string,
  ): void => {
    for (const leaf of leaves(condition)) {
      const target = position.get(leaf.field);
      if (target === undefined) {
        issues.push(
          issue(
            'error',
            'dangling_ref',
            field.id,
            leaf.field,
            `${label(at, field)}: ${what} reads a question that no longer exists.`,
          ),
        );
        continue;
      }
      const targetField = fields[target]!;
      if (target > limit) {
        issues.push(
          issue(
            'error',
            'forward_ref',
            field.id,
            leaf.field,
            `${label(at, field)}: ${what} reads ${label(target, targetField)}, which is not answered yet at that point.`,
          ),
        );
        continue;
      }
      if (targetField.type === 'statement') {
        issues.push(
          issue(
            'error',
            'statement_condition',
            field.id,
            leaf.field,
            `${label(at, field)}: ${what} reads ${label(target, targetField)}, which is a statement and never has an answer.`,
          ),
        );
        continue;
      }
      const problem = typeProblem(leaf, targetField);
      if (problem !== null) {
        issues.push(
          issue(
            'error',
            'type_mismatch',
            field.id,
            leaf.field,
            `${label(at, field)}: ${what} cannot work, because ${problem}.`,
          ),
        );
      }
    }
  };

  fields.forEach((field, at) => {
    if (field.showIf !== undefined) {
      checkCondition(
        field.showIf,
        at,
        field,
        at - 1,
        `“show if ${describeCondition(field.showIf, definition)}”`,
      );
    }
    (field.jumps ?? []).forEach((jump) => {
      const what = `the jump “if ${describeCondition(jump.when, definition)}”`;
      checkCondition(jump.when, at, field, at, what);
      if (jump.to === 'end') return;
      const target = position.get(jump.to);
      if (target === undefined) {
        issues.push(
          issue(
            'error',
            'dangling_ref',
            field.id,
            jump.to,
            `${label(at, field)}: ${what} goes to a question that no longer exists.`,
          ),
        );
      } else if (target <= at) {
        issues.push(
          issue(
            'error',
            'backward_jump',
            field.id,
            jump.to,
            `${label(at, field)}: ${what} goes back to ${label(target, fields[target]!)}. Jumps can only go forward, so a form can never loop.`,
          ),
        );
      }
    });
  });

  // --- Reachability (warning) -------------------------------------------------------
  for (const at of unreachable(definition, position)) {
    const field = fields[at]!;
    issues.push(
      issue(
        'warning',
        'unreachable',
        field.id,
        null,
        `${label(at, field)} can never be shown: every path jumps past it.`,
      ),
    );
  }

  return issues;
}

/**
 * Positions no respondent can reach.
 *
 * A static over-approximation of the walk: every condition is assumed able to go
 * either way, EXCEPT the literal "always" jump, which is the one case that is
 * certain. So the only thing this can prove unreachable is a question every route
 * jumps past, which is exactly the authoring mistake worth a warning. Broken
 * jumps (unknown or backward) are already errors and are treated the way `walk`
 * treats them: as falling through.
 */
function unreachable(definition: FormDefinition, position: ReadonlyMap<FieldId, number>): number[] {
  const { fields } = definition;
  const reached = new Set<number>();
  const considered = new Set<number>();
  const queue: number[] = [0];

  while (queue.length > 0) {
    const at = queue.pop()!;
    if (at >= fields.length || considered.has(at)) continue;
    considered.add(at);
    const field = fields[at]!;
    reached.add(at);

    // A conditionally shown question may be skipped: the walk then considers
    // the next position as if this one were not there.
    if (field.showIf !== undefined) queue.push(at + 1);

    let certain = false;
    for (const jump of field.jumps ?? []) {
      const target = jump.to === 'end' ? fields.length : position.get(jump.to);
      const valid = target !== undefined && target > at;
      queue.push(valid ? target : at + 1);
      if (isAlways(jump.when)) {
        // The first "always" jump decides; later jumps are dead, and so is the
        // fall-through.
        certain = true;
        break;
      }
    }
    if (!certain) queue.push(at + 1);
  }

  return fields.map((_, at) => at).filter((at) => !reached.has(at));
}

export function hasErrors(issues: readonly AnalyzerIssue[]): boolean {
  return issues.some((candidate) => candidate.severity === 'error');
}
