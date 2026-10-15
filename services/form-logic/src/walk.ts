/**
 * The respondent's path, computed in one pass over a complete answer set
 * (docs/SPECS.md 4). This is what the SERVER trusts.
 *
 * Start at the first field. Skip a field whose `showIf` is false. After a shown
 * field, take the first jump whose condition holds (`end` stops), otherwise go to
 * the next field. A field's answer enters the scope the moment the field is on
 * the path, so its own jumps can read it.
 *
 * **It terminates by construction.** A jump is followed only if its target sits
 * strictly AFTER the source, so the index increases on every step and the loop
 * runs at most `fields.length` times. The analyzer refuses to publish a backward
 * jump, and this function does not trust the analyzer: a backward or unknown
 * target is treated as "no jump" and the walk falls through to the next field.
 * A malformed draft in the builder's preview therefore degrades instead of
 * hanging the tab.
 */
import type { AnswerValue, Answers, FieldId, FormDefinition } from '@forms/shared';
import { isAnswerable } from '@forms/shared';

import { isAnswered } from './answers';
import { evaluate, type Scope } from './evaluate';

/** Field id to position, built once per call. */
export function indexOf(definition: FormDefinition): ReadonlyMap<FieldId, number> {
  const index = new Map<FieldId, number>();
  definition.fields.forEach((field, position) => {
    // First occurrence wins. Duplicate ids are an analyzer error; here they only
    // need a deterministic answer.
    if (!index.has(field.id)) index.set(field.id, position);
  });
  return index;
}

/**
 * Where a shown field goes next: the first jump that holds, or the next index.
 *
 * Shared by `walk` and the navigator, because "which jump wins" is the one rule
 * that must not exist twice. Returns `fields.length` for the end of the form.
 */
export function followJumps(
  definition: FormDefinition,
  index: ReadonlyMap<FieldId, number>,
  position: number,
  scope: Scope,
): number {
  const field = definition.fields[position];
  if (field === undefined) return definition.fields.length;
  for (const jump of field.jumps ?? []) {
    if (!evaluate(jump.when, scope)) continue;
    if (jump.to === 'end') return definition.fields.length;
    const target = index.get(jump.to);
    // An unknown or backward target is ignored, and so is everything after it:
    // the FIRST matching jump decides, and a broken first match must not let a
    // later jump win in the preview when the published form would refuse it.
    if (target === undefined || target <= position) return position + 1;
    return target;
  }
  return position + 1;
}

/** Whether the field at `position` is shown, given what is in scope. */
export function isShown(definition: FormDefinition, position: number, scope: Scope): boolean {
  const showIf = definition.fields[position]?.showIf;
  return showIf === undefined || evaluate(showIf, scope);
}

export function walk(definition: FormDefinition, answers: Answers): FieldId[] {
  const index = indexOf(definition);
  const scope = new Map<FieldId, AnswerValue>();
  const path: FieldId[] = [];

  let position = 0;
  while (position < definition.fields.length) {
    const field = definition.fields[position]!;
    if (!isShown(definition, position, scope)) {
      position += 1;
      continue;
    }
    path.push(field.id);
    const answer = answers[field.id];
    if (isAnswerable(field) && isAnswered(answer)) scope.set(field.id, answer);
    position = followJumps(definition, index, position, scope);
  }
  return path;
}

/** The answers restricted to the given path: what a respondent actually submits. */
export function pruneToPath(answers: Answers, path: readonly FieldId[]): Answers {
  const keep = new Set(path);
  const out: Answers = {};
  for (const [id, value] of Object.entries(answers) as Array<[FieldId, AnswerValue]>) {
    if (keep.has(id)) out[id] = value;
  }
  return out;
}
