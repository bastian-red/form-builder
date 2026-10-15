import type { FormDefinition } from '@forms/shared';
import { describe, expect, it, vi } from 'vitest';

import { COUNTER_SQL } from './counters';
import { SQL, type RawQuery } from './queries';
import { filterDocument, parseFilterValue, versionResults, type ResultsCache } from './results';

const ROLE = 'f_role0001';
const SCORE = 'f_score001';
const TOOLS = 'f_tools001';
const NOTE = 'f_note0001';

const DEFINITION: FormDefinition = {
  schemaVersion: 1,
  title: 'T',
  ending: { title: 'Done', message: '' },
  fields: [
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
    { id: SCORE, type: 'nps', title: 'Score', required: true },
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
    { id: NOTE, type: 'long_text', title: 'Note', required: false, maxLength: 500 },
    { id: 'f_stmt0001', type: 'statement', title: 'Bye', required: false },
  ],
};

/** A fake database answering each constant query with canned rows, recording parameters. */
function fakeRaw(): { raw: RawQuery; calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const scan: Array<[string, unknown[]]> = [
    [SQL.fingerprint, [{ n: 3, last: new Date('2026-10-01T10:00:00Z') }]],
    [SQL.totals, [{ started: 4, completed: 3 }]],
    [
      SQL.durations,
      [
        { seconds: 40, count: 1 },
        { seconds: 45, count: 1 },
        { seconds: 90, count: 1 },
      ],
    ],
    [
      SQL.answered,
      [
        { field_id: ROLE, count: 3 },
        { field_id: SCORE, count: 3 },
        { field_id: TOOLS, count: 2 },
        { field_id: NOTE, count: 1 },
      ],
    ],
    [
      SQL.scalar,
      [
        { field_id: ROLE, value: 'o_aaaaaaaa', count: 2 },
        { field_id: ROLE, value: 'o_bbbbbbbb', count: 1 },
        { field_id: SCORE, value: 10, count: 2 },
        { field_id: SCORE, value: 3, count: 1 },
      ],
    ],
    [SQL.multi, [{ field_id: TOOLS, option_id: 'o_dddddddd', count: 2 }]],
    [
      SQL.latestText,
      [{ field_id: NOTE, value: 'Great', submitted_at: new Date('2026-10-01T09:00:00Z') }],
    ],
    [
      SQL.reached,
      [
        { field_id: ROLE, reached_all: 4, reached_completed: 3 },
        { field_id: SCORE, reached_all: 3, reached_completed: 3 },
      ],
    ],
  ];
  // The same facts as counters, which is what an unfiltered read uses.
  const counters: Array<[string, unknown[]]> = [
    [COUNTER_SQL.readVersion, [{ started: 4, completed: 3 }]],
    [
      COUNTER_SQL.readFields,
      [
        { field_id: ROLE, reached_all: 4, reached_completed: 3, answered: 3 },
        { field_id: SCORE, reached_all: 3, reached_completed: 3, answered: 3 },
        { field_id: TOOLS, reached_all: 0, reached_completed: 0, answered: 2 },
        { field_id: NOTE, reached_all: 0, reached_completed: 0, answered: 1 },
      ],
    ],
    [
      COUNTER_SQL.readAnswers,
      [
        { field_id: ROLE, value: 'o_aaaaaaaa', count: 2 },
        { field_id: ROLE, value: 'o_bbbbbbbb', count: 1 },
        { field_id: SCORE, value: 10, count: 2 },
        { field_id: SCORE, value: 3, count: 1 },
        { field_id: TOOLS, value: 'o_dddddddd', count: 2 },
      ],
    ],
    [
      COUNTER_SQL.readDurations,
      [
        { seconds: 40, count: 1 },
        { seconds: 45, count: 1 },
        { seconds: 90, count: 1 },
      ],
    ],
  ];
  const rows = new Map<string, unknown[]>([...scan, ...counters]);

  const raw = (async (sql: string, ...params: unknown[]) => {
    calls.push({ sql, params });
    return rows.get(sql) ?? [];
  }) as RawQuery;
  return { raw, calls };
}

function memoryCache(): ResultsCache & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
    },
  };
}

const VERSION = { id: 'cversion000000000000001', version: 2, definition: DEFINITION };

describe('versionResults', () => {
  it('turns counts into the contract, in form order, skipping statements', async () => {
    const { raw } = fakeRaw();
    const results = await versionResults(
      { raw, cache: memoryCache(), ttlSeconds: 60, now: () => new Date('2026-10-14T00:00:00Z') },
      VERSION,
      null,
    );
    expect(results.totals).toEqual({ started: 4, completed: 3, medianSecondsToComplete: 45 });
    expect(results.fields.map((field) => field.fieldId)).toEqual([ROLE, SCORE, TOOLS, NOTE]);
    expect(results.fields[0]!.result).toEqual({
      kind: 'choice',
      multiple: false,
      options: [
        { optionId: 'o_aaaaaaaa', label: 'A', count: 2 },
        { optionId: 'o_bbbbbbbb', label: 'B', count: 1 },
      ],
    });
    // 2 promoters, 1 detractor of 3: (2 - 1) / 3 = 33.3 -> 33.
    expect(results.fields[1]!.result).toMatchObject({
      kind: 'nps',
      promoters: 2,
      detractors: 1,
      score: 33,
    });
    expect(results.fields[2]!.result).toMatchObject({
      options: [
        { optionId: 'o_cccccccc', count: 0 },
        { optionId: 'o_dddddddd', count: 2 },
      ],
    });
    expect(results.fields[3]!.result).toEqual({
      kind: 'text',
      latest: [{ value: 'Great', submittedAt: '2026-10-01T09:00:00.000Z' }],
    });
    expect(results.funnel.map((step) => step.reached)).toEqual([4, 3, 0, 0, 0]);
    expect(results.fields[3]!.answered).toBe(1);
    expect(results.cached).toBe(false);
  });

  it('reads an unfiltered report from the counters only, never scanning responses', async () => {
    const { raw, calls } = fakeRaw();
    await versionResults({ raw, cache: memoryCache(), ttlSeconds: 60 }, VERSION, null);
    const scanned = calls.filter(
      (call) => (Object.values(SQL) as string[]).includes(call.sql) && call.sql !== SQL.latestText,
    );
    expect(scanned).toEqual([]);
  });

  it('never walks the text index for a text question nobody answered', async () => {
    const { raw, calls } = fakeRaw();
    const unanswered = (async (sql: string, ...params: unknown[]) =>
      sql === COUNTER_SQL.readFields ? [] : raw(sql, ...params)) as RawQuery;
    await versionResults({ raw: unanswered, cache: memoryCache(), ttlSeconds: 60 }, VERSION, null);
    expect(calls.some((call) => call.sql === SQL.latestText)).toBe(false);
  });

  it('gives the same report from counters and from a scan', async () => {
    // The two paths must be indistinguishable to build.ts. The filter here is
    // satisfied by every fake row, so the scan sees the same data.
    const { raw } = fakeRaw();
    const counted = await versionResults(
      { raw, cache: memoryCache(), ttlSeconds: 60 },
      VERSION,
      null,
    );
    const scanned = await versionResults({ raw, cache: memoryCache(), ttlSeconds: 60 }, VERSION, {
      field: DEFINITION.fields[0]!,
      value: 'o_aaaaaaaa',
    });
    expect({ ...scanned, filter: null, generatedAt: '' }).toEqual({ ...counted, generatedAt: '' });
  });

  it('serves a repeated filtered read from the cache, keyed by the fingerprint', async () => {
    const { raw, calls } = fakeRaw();
    const cache = memoryCache();
    const filter = { field: DEFINITION.fields[0]!, value: 'o_aaaaaaaa' };
    await versionResults({ raw, cache, ttlSeconds: 60 }, VERSION, filter);
    const before = calls.length;
    const second = await versionResults({ raw, cache, ttlSeconds: 60 }, VERSION, filter);
    expect(second.cached).toBe(true);
    // Only the fingerprint ran the second time.
    expect(calls.slice(before).map((call) => call.sql)).toEqual([SQL.fingerprint]);
    expect([...cache.store.keys()][0]).toBe(
      'results:v1:cversion000000000000001:{"f_role0001":"o_aaaaaaaa"}:3:2026-10-01T10:00:00.000Z',
    );
  });

  it('computes directly when the cache is down, rather than failing the page', async () => {
    const { raw } = fakeRaw();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: ResultsCache = {
      get: () => Promise.reject(new Error('ECONNREFUSED')),
      set: () => Promise.reject(new Error('ECONNREFUSED')),
    };
    const results = await versionResults({ raw, cache: broken, ttlSeconds: 60 }, VERSION, {
      field: DEFINITION.fields[0]!,
      value: 'o_aaaaaaaa',
    });
    expect(results.totals.completed).toBe(3);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('passes the filter to every query as one containment document', async () => {
    const { raw, calls } = fakeRaw();
    const field = DEFINITION.fields[2]!;
    await versionResults({ raw, cache: memoryCache(), ttlSeconds: 60 }, VERSION, {
      field,
      value: 'o_dddddddd',
    });
    const filtered = calls.filter((call) => call.sql !== SQL.fingerprint);
    expect(filtered.every((call) => call.params[1] === '{"f_tools001":["o_dddddddd"]}')).toBe(true);
  });
});

describe('parseFilterValue', () => {
  it('types the query-string text by the field it filters', () => {
    expect(parseFilterValue(DEFINITION.fields[0]!, 'o_aaaaaaaa')).toBe('o_aaaaaaaa');
    expect(parseFilterValue(DEFINITION.fields[0]!, 'o_zzzzzzzz')).toBeNull();
    expect(parseFilterValue(DEFINITION.fields[1]!, '10')).toBe(10);
    expect(parseFilterValue(DEFINITION.fields[1]!, '11')).toBeNull();
    expect(parseFilterValue(DEFINITION.fields[3]!, 'Great')).toBeNull();
    expect(filterDocument(DEFINITION.fields[0]!, 'o_aaaaaaaa')).toBe('{"f_role0001":"o_aaaaaaaa"}');
  });
});
