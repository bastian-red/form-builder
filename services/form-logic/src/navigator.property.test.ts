/**
 * The property behind docs/SPECS.md outcome 1: the server accepts exactly what
 * the respondent's navigator could have produced.
 *
 * The respondent renderer moves one question at a time with `nextField`, keeps
 * stale answers when somebody goes Back and changes branch, and sends
 * `submission(history, answers)`. The server knows none of that history: it runs
 * `validateSubmission`, which walks the logic over the answers alone. For every
 * generated form and every generated respondent:
 *
 *   1. the server's walk reproduces the navigator's history exactly;
 *   2. a respondent who answered every required question they were shown is
 *      accepted, with no problems;
 *   3. adding an answer to any question they were NOT shown is refused as
 *      `hidden_answered` -- the scripted-client attack.
 *
 * Fixed seed, so a failure is reproducible and the gate lane never flakes.
 */
import type {
  Condition,
  Field,
  FieldId,
  FormDefinition,
  AnswerValue,
  Answers,
} from '@forms/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { firstField, nextField, progress, submission } from './navigator';
import { validateSubmission } from './validate';
import { walk } from './walk';

const SEED = 20261014;
const RUNS = 2000;

type Kind = 'single_choice' | 'number' | 'yes_no' | 'nps' | 'short_text' | 'statement';
const KINDS: Kind[] = ['single_choice', 'number', 'yes_no', 'nps', 'short_text', 'statement'];

const fieldId = (i: number): FieldId => `f_${String(i).padStart(8, '0')}`;
const optionId = (i: number): string => `o_${String(i).padStart(8, '0')}`;

function makeField(kind: Kind, i: number, required: boolean): Field {
  const base = {
    id: fieldId(i),
    title: `Q${String(i)}`,
    required: kind === 'statement' ? false : required,
  };
  switch (kind) {
    case 'single_choice':
      return {
        ...base,
        type: kind,
        options: [0, 1, 2].map((o) => ({ id: optionId(o), label: `Option ${String(o)}` })),
      };
    case 'number':
      return { ...base, type: kind, integer: true, min: 0, max: 20 };
    case 'yes_no':
      return { ...base, type: kind };
    case 'nps':
      return { ...base, type: kind };
    case 'short_text':
      return { ...base, type: kind, maxLength: 50 };
    case 'statement':
      return { ...base, type: kind, required: false };
  }
}

/** A type-correct leaf reading `target`, chosen by `pick` (a number in [0, 1)). */
function leafFor(target: Field, pick: number, value: number): Condition {
  if (pick < 0.2) return { op: 'answered', field: target.id };
  if (pick < 0.3) return { op: 'not', of: { op: 'answered', field: target.id } };
  switch (target.type) {
    case 'single_choice':
      return pick < 0.7
        ? { op: 'eq', field: target.id, value: optionId(value % 3) }
        : { op: 'neq', field: target.id, value: optionId(value % 3) };
    case 'number':
      return { op: pick < 0.65 ? 'lt' : 'gte', field: target.id, value: value % 21 };
    case 'nps':
      return { op: pick < 0.65 ? 'lt' : 'gte', field: target.id, value: value % 11 };
    case 'yes_no':
      return { op: 'eq', field: target.id, value: value % 2 === 0 };
    default:
      return { op: 'answered', field: target.id };
  }
}

function sometimes<T>(arbitrary: fc.Arbitrary<T>): fc.Arbitrary<T | null> {
  return fc.oneof({ arbitrary: fc.constant(null), weight: 1 }, { arbitrary, weight: 1 });
}

/** A form: kinds, plus raw numbers the builder below turns into forward-only logic. */
const formArbitrary = fc
  .record({
    kinds: fc.array(fc.constantFrom(...KINDS), { minLength: 2, maxLength: 10 }),
    required: fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
    logic: fc.array(
      fc.record({
        // Sparse on purpose: about one field in three carries a rule. With a rule
        // on nearly every field, most generated forms end after one or two
        // questions, Back-and-change-branch never happens, and the property
        // passes without testing the case it exists for. Measured: the dense
        // version let a navigator that read stale answers through 2,000 runs.
        showIf: sometimes(
          fc.tuple(fc.nat(), fc.double({ min: 0, max: 0.999, noNaN: true }), fc.nat()),
        ),
        jump: sometimes(
          fc.tuple(fc.nat(), fc.double({ min: 0, max: 0.999, noNaN: true }), fc.nat(), fc.nat()),
        ),
      }),
      { minLength: 10, maxLength: 10 },
    ),
  })
  .map(({ kinds, required, logic }): FormDefinition => {
    const fields = kinds.map((kind, i) => makeField(kind, i, required[i]!));
    fields.forEach((field, i) => {
      const spec = logic[i]!;
      // showIf reads an EARLIER answerable field; jumps read this or an earlier one
      // and target a LATER field or the end. Exactly what the analyzer allows.
      const earlier = fields.slice(0, i).filter((candidate) => candidate.type !== 'statement');
      if (spec.showIf && earlier.length > 0) {
        const [which, pick, value] = spec.showIf;
        fields[i] = {
          ...fields[i]!,
          showIf: leafFor(earlier[which % earlier.length]!, pick, value),
        } as Field;
      }
      const readable = fields.slice(0, i + 1).filter((candidate) => candidate.type !== 'statement');
      if (spec.jump && readable.length > 0) {
        const [which, pick, value, to] = spec.jump;
        const targets = fields.length - i; // later fields + 'end'
        const t = to % targets;
        const target = t === targets - 1 ? 'end' : fields[i + 1 + t]!.id;
        fields[i] = {
          ...fields[i]!,
          jumps: [{ when: leafFor(readable[which % readable.length]!, pick, value), to: target }],
        } as Field;
      }
    });
    return { schemaVersion: 1, title: 'Generated', fields, ending: { title: 'Done', message: '' } };
  });

/** A valid answer for a field, derived from a number. */
function answerFor(field: Field, n: number): AnswerValue | undefined {
  switch (field.type) {
    case 'single_choice':
      return optionId(n % 3);
    case 'number':
      return n % 21;
    case 'nps':
      return n % 11;
    case 'yes_no':
      return n % 2 === 0;
    case 'short_text':
      return `answer ${String(n % 7)}`;
    default:
      return undefined;
  }
}

/** One respondent: a list of moves. Each is "answer with n (or skip) and go on", or "go back". */
const respondentArbitrary = fc.array(
  fc.record({ back: fc.double({ min: 0, max: 1, noNaN: true }), n: fc.nat(), skip: fc.boolean() }),
  { minLength: 0, maxLength: 60, size: 'max' },
);

interface Outcome {
  readonly finished: boolean;
  readonly history: FieldId[];
  readonly answers: Answers;
}

function simulate(
  definition: FormDefinition,
  moves: Array<{ back: number; n: number; skip: boolean }>,
): Outcome {
  const byId = new Map(definition.fields.map((field) => [field.id, field] as const));
  const first = firstField(definition);
  if (first === null) return { finished: true, history: [], answers: {} };

  const history: FieldId[] = [first];
  const answers: Answers = {};

  // The random part: answers, skips and Back, in any order. Then the respondent
  // finishes by answering forward, so every run reaches the end and none is
  // discarded; the random prefix is what leaves stale answers behind.
  const finishing = definition.fields.map((_, i) => ({ back: 1, n: i, skip: false }));
  for (const move of [...moves, ...finishing, ...finishing]) {
    // Typing comes first, as in the renderer: the answers state changes on
    // input, not on Next, so pressing Back keeps what was typed into the
    // question being left. That is the main way stale answers are born.
    const field = byId.get(history.at(-1)!)!;
    const value = answerFor(field, move.n);
    if (value !== undefined && (field.required || !move.skip)) answers[field.id] = value;
    else delete answers[field.id];
    if (move.back < 0.4 && history.length > 1) {
      history.pop();
      continue;
    }
    const next = nextField(definition, history, answers);
    if (next === null) return { finished: true, history, answers };
    history.push(next);
  }
  return { finished: false, history, answers };
}

describe('navigator against the server walk', () => {
  it('reproduces the history, accepts the honest submission, refuses hidden answers', () => {
    let finishedRuns = 0;
    let staleRuns = 0;
    fc.assert(
      fc.property(formArbitrary, respondentArbitrary, fc.nat(), (definition, moves, extra) => {
        const outcome = simulate(definition, moves);
        fc.pre(outcome.finished);
        finishedRuns += 1;
        const shownNow = new Set(outcome.history);
        if (Object.keys(outcome.answers).some((id) => !shownNow.has(id as FieldId))) staleRuns += 1;

        const sent = submission(outcome.history, outcome.answers);

        // 1. The server's walk is the navigator's history.
        expect(walk(definition, sent)).toEqual(outcome.history);

        // 2. Honest and finished means accepted.
        const verdict = validateSubmission(definition, sent, { complete: true });
        expect(verdict.problems).toEqual([]);
        expect(verdict.path).toEqual(outcome.history);

        // 3. Smuggle an answer to a question that was not shown.
        const shown = new Set(outcome.history);
        const hidden = definition.fields.filter(
          (field) => !shown.has(field.id) && field.type !== 'statement',
        );
        if (hidden.length > 0) {
          const target = hidden[extra % hidden.length]!;
          const forged = { ...sent, [target.id]: answerFor(target, extra)! };
          const refused = validateSubmission(definition, forged, { complete: true });
          expect(refused.problems).toContainEqual(
            expect.objectContaining({ fieldId: target.id, code: 'hidden_answered' }),
          );
        }

        // The progress estimate never runs behind what has been shown.
        const { position, total } = progress(definition, outcome.history, outcome.answers);
        expect(total).toBeGreaterThanOrEqual(position);
      }),
      { seed: SEED, numRuns: RUNS },
    );
    // Every respondent finishes (see `simulate`). And the case this property
    // exists for -- answers left behind by Back on a branch no longer taken --
    // must actually occur, or the property passes without testing it. An
    // earlier generator produced it zero times in 2,000 runs, and a navigator
    // that read those stale answers passed.
    expect(finishedRuns).toBe(RUNS);
    expect(staleRuns).toBeGreaterThan(RUNS / 10);
    console.info(
      `[property] ${String(staleRuns)} of ${String(RUNS)} respondents left stale answers behind`,
    );
  });
});
