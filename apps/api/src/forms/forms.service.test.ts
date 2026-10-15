import { describe, expect, it } from 'vitest';
import { slugSchema } from '@forms/shared';

import { newSlug } from './forms.service';
import { DefinitionCache } from '../respond/respond.service';
import { decodeCursor, encodeCursor } from '../results/results.service';

describe('newSlug', () => {
  it('produces slugs the contract and the CHECK accept', () => {
    for (let i = 0; i < 200; i += 1) expect(slugSchema.safeParse(newSlug()).success).toBe(true);
  });

  it('redraws biased bytes', () => {
    let calls = 0;
    const source = (size: number) => {
      calls += 1;
      return Buffer.alloc(size, calls === 1 ? 252 : 0);
    };
    expect(newSlug(source)).toBe('aaaaaaaaaa');
    expect(calls).toBe(2);
  });
});

describe('DefinitionCache', () => {
  it('parses a version once and evicts the oldest past capacity', () => {
    const cache = new DefinitionCache(2);
    let loads = 0;
    const load = () => {
      loads += 1;
      return {
        schemaVersion: 1 as const,
        title: 't',
        fields: [],
        ending: { title: 'e', message: '' },
      };
    };
    cache.get('a', load);
    cache.get('a', load);
    expect(loads).toBe(1);
    cache.get('b', load);
    cache.get('c', load);
    expect(cache.size).toBe(2);
    cache.get('a', load);
    expect(loads).toBe(4);
  });
});

describe('response cursor', () => {
  it('round-trips', () => {
    const at = new Date('2026-10-01T10:00:00.123Z');
    const id = '3b241101-e2bb-4255-8caf-4136c566a962';
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ submittedAt: at, id });
  });

  it('refuses a cursor this server did not issue', () => {
    expect(() => decodeCursor('bm90IGEgY3Vyc29y')).toThrow(/cursor/u);
    expect(() =>
      decodeCursor(Buffer.from("2026-10-01T10:00:00Z|' OR 1=1").toString('base64url')),
    ).toThrow();
  });
});
