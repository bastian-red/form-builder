import { describe, expect, it } from 'vitest';

import { responseIdSchema, slugSchema } from './primitives';

describe('responseIdSchema', () => {
  it('accepts a v4 UUID, which is what crypto.randomUUID() produces', () => {
    expect(responseIdSchema.safeParse('3b241101-e2bb-4255-8caf-4136c566a962').success).toBe(true);
  });

  it('refuses other UUID versions and anything uppercase', () => {
    // A v1 UUID embeds the MAC address and the time; the id is the only thing
    // keeping one respondent's draft from another, so it must be the random kind.
    expect(responseIdSchema.safeParse('6fa459ea-ee8a-11ca-8f3b-0242ac120002').success).toBe(false);
    expect(responseIdSchema.safeParse('3B241101-E2BB-4255-8CAF-4136C566A962').success).toBe(false);
    expect(responseIdSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('slugSchema', () => {
  it('accepts lowercase words and digits', () => {
    expect(slugSchema.safeParse('product-feedback').success).toBe(true);
    expect(slugSchema.safeParse('k3x9q2mzp0').success).toBe(true);
  });

  it('refuses what would make a link ambiguous or unsafe', () => {
    for (const bad of ['ABC12', '-lead', 'a/b/c', 'abc', 'x'.repeat(41), '../etc']) {
      expect(slugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
