import type { Answers, FieldId, FormDefinition } from '@forms/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { responseDeltas, type StatsRows } from './counters';

const ROLE = 'f_role0001';
const TOOLS = 'f_tools001';
const SCORE = 'f_score001';
const NOTE = 'f_note0001';
const INTRO = 'f_intro001';

const DEFINITION: FormDefinition = {
  schemaVersion: 1,
  title: 'T',
  ending: { title: 'Done', message: '' },
  fields: [
    { id: INTRO, type: 'statement', title: 'Hi', required: false },
    {
      id: ROLE,
      type: 'single_choice',
      title: 'Role',
      required: true,
      options: [
        { id: 'o_aaaaaaaa', label: 'A' },
        { id: 'o_bbbbbbbb', label: 'B' },
      ],
    },
    {
      id: TOOLS,
      type: 'multi_choice',
      title: 'Tools',
      required: false,
      options: [
        { id: 'o_cccccccc', label: 'C' },
        { id: 'o_dddddddd', label: 'D' },
      ],
    },
    { id: SCORE, type: 'nps', title: 'Score', required: true },
    { id: NOTE, type: 'long_text', title: 'Note', required: false, maxLength: 100 },
  ],
};

describe('responseDeltas', () => {
  it('counts a new partial response as started and its reached fields, nothing else', () => {
    expect(
      responseDeltas(DEFINITION, null, {
        reached: [INTRO, ROLE],
        answers: { [ROLE]: 'o_aaaaaaaa' },
        complete: false,
        seconds: 5,
      }),
    ).toEqual({
      started: 1,
      completed: 0,
      fields: [
        { fieldId: INTRO, reachedAll: 1, reachedCompleted: 0, answered: 0 },
        { fieldId: ROLE, reachedAll: 1, reachedCompleted: 0, answered: 0 },
      ],
      answers: [],
      durations: [],
    });
  });

  it('takes a field back off the funnel when the respondent changes branch', () => {
    const deltas = responseDeltas(
      DEFINITION,
      { reached: [ROLE, TOOLS] },
      { reached: [ROLE], answers: {}, complete: false, seconds: 9 },
    );
    expect(deltas.started).toBe(0);
    expect(deltas.fields).toEqual([
      { fieldId: TOOLS, reachedAll: -1, reachedCompleted: 0, answered: 0 },
    ]);
  });

  it('on completion counts each option of a multi-choice, answered text, and the duration', () => {
    const deltas = responseDeltas(
      DEFINITION,
      { reached: [INTRO, ROLE, TOOLS, SCORE, NOTE] },
      {
        reached: [INTRO, ROLE, TOOLS, SCORE, NOTE],
        answers: {
          [ROLE]: 'o_bbbbbbbb',
          [TOOLS]: ['o_cccccccc', 'o_dddddddd'],
          [SCORE]: 0,
          [NOTE]: 'hi',
        },
        complete: true,
        seconds: 61.9,
      },
    );
    expect(deltas.completed).toBe(1);
    expect(deltas.answers).toEqual([
      { fieldId: ROLE, value: 'o_bbbbbbbb', count: 1 },
      { fieldId: TOOLS, value: 'o_cccccccc', count: 1 },
      { fieldId: TOOLS, value: 'o_dddddddd', count: 1 },
      { fieldId: SCORE, value: 0, count: 1 },
    ]);
    expect(deltas.fields.find((row) => row.fieldId === NOTE)).toEqual({
      fieldId: NOTE,
      reachedAll: 0,
      reachedCompleted: 1,
      answered: 1,
    });
    expect(deltas.durations).toEqual([{ seconds: 61, count: 1 }]);
  });
});

/**
 * An independent recount: what the counters must equal, computed from the final
 * rows directly, the way the SQL scan does. Written separately from
 * `responseDeltas` so the property compares two implementations, not one with
 * itself.
 */
function scan(
  rows: ReadonlyArray<{
    reached: FieldId[];
    answers: Answers;
    submitted: boolean;
    seconds: number;
  }>,
): StatsRows {
  const fields = new Map<
    string,
    { reachedAll: number; reachedCompleted: number; answered: number }
  >();
  const answers = new Map<string, number>();
  const durations = new Map<number, number>();
  const field = (id: string) =>
    fields.get(id) ??
    (fields.set(id, { reachedAll: 0, reachedCompleted: 0, answered: 0 }), fields.get(id)!);
  for (const row of rows) {
    for (const id of row.reached) {
      field(id).reachedAll += 1;
      if (row.submitted) field(id).reachedCompleted += 1;
    }
    if (!row.submitted) continue;
    for (const [id, value] of Object.entries(row.answers)) {
      field(id).answered += 1;
      if (id === NOTE) continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        const key = JSON.stringify([id, item]);
        answers.set(key, (answers.get(key) ?? 0) + 1);
      }
    }
    durations.set(Math.floor(row.seconds), (durations.get(Math.floor(row.seconds)) ?? 0) + 1);
  }
  return {
    started: rows.length,
    completed: rows.filter((row) => row.submitted).length,
    fields: [...fields.entries()].map(([fieldId, row]) => ({ fieldId, ...row })),
    answers: [...answers.entries()].map(([key, count]) => {
      const [fieldId, value] = JSON.parse(key) as [string, unknown];
      return { fieldId, value, count };
    }),
    durations: [...durations.entries()].map(([seconds, count]) => ({ seconds, count })),
  };
}

/** Sum deltas, dropping zero rows, in a canonical order so two totals compare. */
function sum(all: readonly StatsRows[]): StatsRows {
  const fields = new Map<
    string,
    { reachedAll: number; reachedCompleted: number; answered: number }
  >();
  const answers = new Map<string, { fieldId: string; value: unknown; count: number }>();
  const durations = new Map<number, number>();
  let started = 0;
  let completed = 0;
  for (const rows of all) {
    started += rows.started;
    completed += rows.completed;
    for (const row of rows.fields) {
      const entry = fields.get(row.fieldId) ?? { reachedAll: 0, reachedCompleted: 0, answered: 0 };
      entry.reachedAll += row.reachedAll;
      entry.reachedCompleted += row.reachedCompleted;
      entry.answered += row.answered;
      fields.set(row.fieldId, entry);
    }
    for (const row of rows.answers) {
      const key = JSON.stringify([row.fieldId, row.value]);
      const entry = answers.get(key) ?? { fieldId: row.fieldId, value: row.value, count: 0 };
      entry.count += row.count;
      answers.set(key, entry);
    }
    for (const row of rows.durations)
      durations.set(row.seconds, (durations.get(row.seconds) ?? 0) + row.count);
  }
  const byKey =
    <T>(key: (item: T) => string) =>
    (a: T, b: T) =>
      key(a).localeCompare(key(b));
  return {
    started,
    completed,
    fields: [...fields.entries()]
      .filter(([, row]) => row.reachedAll !== 0 || row.reachedCompleted !== 0 || row.answered !== 0)
      .map(([fieldId, row]) => ({ fieldId, ...row }))
      .sort(byKey((row) => row.fieldId)),
    answers: [...answers.values()]
      .filter((row) => row.count !== 0)
      .sort(byKey((row) => JSON.stringify([row.fieldId, row.value]))),
    durations: [...durations.entries()]
      .filter(([, count]) => count !== 0)
      .map(([seconds, count]) => ({ seconds, count }))
      .sort((a, b) => a.seconds - b.seconds),
  };
}

const ALL_FIELDS = [INTRO, ROLE, TOOLS, SCORE, NOTE];

const state = fc.record({
  reached: fc.subarray(ALL_FIELDS),
  role: fc.option(fc.constantFrom('o_aaaaaaaa', 'o_bbbbbbbb')),
  tools: fc.option(fc.subarray(['o_cccccccc', 'o_dddddddd'], { minLength: 1 })),
  score: fc.option(fc.integer({ min: 0, max: 10 })),
  note: fc.option(fc.constantFrom('a', 'b')),
  seconds: fc.double({ min: 0, max: 3600, noNaN: true }),
});

/** One response: a series of partial saves, optionally ending in a final one. */
const response = fc.record({
  saves: fc.array(state, { minLength: 1, maxLength: 5 }),
  completes: fc.boolean(),
});

describe('the split between increments and decrements', () => {
  it('never puts a negative and a positive in one field delta', () => {
    // applyDeltas routes a field to the upsert or to the UPDATE by the sign of
    // reachedAll alone; a mixed delta would lose its positive half.
    fc.assert(
      fc.property(state, state, fc.boolean(), (before, after, complete) => {
        const deltas = responseDeltas(
          DEFINITION,
          { reached: before.reached },
          { reached: after.reached, answers: {}, complete, seconds: 1 },
        );
        for (const row of deltas.fields) {
          if (row.reachedAll < 0) expect([row.reachedCompleted, row.answered]).toEqual([0, 0]);
        }
      }),
      { seed: 7, numRuns: 500 },
    );
  });
});

describe('counters against an independent recount', () => {
  it('equal the recount after any sequence of partial and final saves', () => {
    fc.assert(
      fc.property(fc.array(response, { maxLength: 15 }), (responses) => {
        const deltas: StatsRows[] = [];
        const finals: Array<{
          reached: FieldId[];
          answers: Answers;
          submitted: boolean;
          seconds: number;
        }> = [];
        for (const { saves, completes } of responses) {
          let previous: { reached: FieldId[] } | null = null;
          let last: (typeof finals)[number] | null = null;
          saves.forEach((save, i) => {
            const answers: Answers = {};
            if (save.role !== null) answers[ROLE] = save.role;
            if (save.tools !== null) answers[TOOLS] = save.tools;
            if (save.score !== null) answers[SCORE] = save.score;
            if (save.note !== null) answers[NOTE] = save.note;
            const complete = completes && i === saves.length - 1;
            deltas.push(
              responseDeltas(DEFINITION, previous, {
                reached: save.reached,
                answers,
                complete,
                seconds: save.seconds,
              }),
            );
            previous = { reached: save.reached };
            last = { reached: save.reached, answers, submitted: complete, seconds: save.seconds };
          });
          finals.push(last!);
        }
        expect(sum(deltas)).toEqual(sum([scan(finals)]));
      }),
      { seed: 20261015, numRuns: 1000 },
    );
  });
});
