/**
 * The arithmetic on top of the counts SQL returns.
 *
 * Postgres groups and counts; everything that turns counts into a statistic is
 * here, as pure functions over `{ value, count }` lists, so each one is unit
 * tested against hand-checkable inputs instead of against a database. A median
 * computed from counts is exact (no sampling) and costs nothing extra, because
 * the counts are already in memory.
 */

export interface ValueCount {
  readonly value: number;
  readonly count: number;
}

export function total(counts: readonly ValueCount[]): number {
  return counts.reduce((sum, entry) => sum + entry.count, 0);
}

export function mean(counts: readonly ValueCount[]): number | null {
  const n = total(counts);
  if (n === 0) return null;
  return counts.reduce((sum, entry) => sum + entry.value * entry.count, 0) / n;
}

/**
 * The exact median of the multiset the counts describe. With an even number of
 * values it is the mean of the two middle ones, the textbook definition, which
 * is also what Postgres's `percentile_cont(0.5)` returns.
 */
export function median(counts: readonly ValueCount[]): number | null {
  const n = total(counts);
  if (n === 0) return null;
  const sorted = [...counts].filter((entry) => entry.count > 0).sort((a, b) => a.value - b.value);
  // 0-based ranks of the middle value(s).
  const low = Math.floor((n - 1) / 2);
  const high = Math.ceil((n - 1) / 2);
  let seen = 0;
  let lowValue: number | null = null;
  for (const entry of sorted) {
    const last = seen + entry.count - 1;
    if (lowValue === null && low <= last) lowValue = entry.value;
    if (high <= last) return (lowValue! + entry.value) / 2;
    seen += entry.count;
  }
  return null;
}

export interface NpsSummary {
  readonly detractors: number;
  readonly passives: number;
  readonly promoters: number;
  readonly score: number | null;
}

/**
 * Net Promoter Score: % promoters (9-10) minus % detractors (0-6), as an
 * integer from -100 to 100.
 *
 * Rounded half away from zero on the exact fraction, so -12.5 is -13 and 12.5
 * is 13. `Math.round` alone rounds -12.5 to -12, which would make the score
 * depend on its sign, and the score is often negative.
 */
export function nps(counts: readonly ValueCount[]): NpsSummary {
  let detractors = 0;
  let passives = 0;
  let promoters = 0;
  for (const { value, count } of counts) {
    if (value >= 9) promoters += count;
    else if (value >= 7) passives += count;
    else detractors += count;
  }
  const n = detractors + passives + promoters;
  if (n === 0) return { detractors, passives, promoters, score: null };
  const exact = ((promoters - detractors) * 100) / n;
  const score = Math.sign(exact) * Math.round(Math.abs(exact));
  // `Math.sign(-0.4) * 0` is -0; normalise so the JSON is never "-0".
  return { detractors, passives, promoters, score: score === 0 ? 0 : score };
}

export interface Bin {
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

const MAX_BINS = 10;

/**
 * A histogram over a PINNED domain (docs/DESIGN.md 3.2).
 *
 * The domain is the field's own `min`/`max` when the author set them, so two
 * versions of the same question draw on the same axis; otherwise it is the
 * data's range. Whole-number questions over a small range get one bin per
 * value, because "3-4" is a worse label than "3" and "4" when there are only
 * ten of them.
 *
 * Bins are `[from, to)` except the last, which includes `to`, so the maximum
 * value always lands somewhere.
 */
export function histogram(
  counts: readonly ValueCount[],
  options: { min?: number; max?: number; integer: boolean },
): Bin[] {
  const present = counts.filter((entry) => entry.count > 0);
  if (present.length === 0 && (options.min === undefined || options.max === undefined)) return [];

  const values = present.map((entry) => entry.value);
  const low = options.min ?? Math.min(...values);
  const high = options.max ?? Math.max(...values);
  if (high < low) return [];

  if (options.integer && high - low + 1 <= MAX_BINS * 2) {
    const bins: Bin[] = [];
    for (let value = Math.ceil(low); value <= Math.floor(high); value += 1) {
      bins.push({
        from: value,
        to: value,
        count: present
          .filter((entry) => entry.value === value)
          .reduce((sum, e) => sum + e.count, 0),
      });
    }
    return bins;
  }

  if (high === low) return [{ from: low, to: high, count: total(present) }];

  // Whole numbers over a wide range: whole-number edges, so a bin reads "21–40"
  // rather than "20.9–40.8", and every integer lands in exactly one bin.
  if (options.integer) {
    const first = Math.ceil(low);
    const last = Math.floor(high);
    const step = Math.ceil((last - first + 1) / MAX_BINS);
    const bins: Bin[] = [];
    for (let from = first; from <= last; from += step) {
      const to = Math.min(last, from + step - 1);
      bins.push({
        from,
        to,
        count: present
          .filter((entry) => entry.value >= from && entry.value <= to)
          .reduce((sum, e) => sum + e.count, 0),
      });
    }
    return bins;
  }

  const width = (high - low) / MAX_BINS;
  const bins = Array.from({ length: MAX_BINS }, (_, i) => ({
    from: low + i * width,
    to: i === MAX_BINS - 1 ? high : low + (i + 1) * width,
    count: 0,
  }));
  for (const { value, count } of present) {
    if (value < low || value > high) continue;
    const index = Math.min(MAX_BINS - 1, Math.floor((value - low) / width));
    bins[index]!.count += count;
  }
  return bins;
}
