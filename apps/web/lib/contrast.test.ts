/**
 * Every colour pair this app paints, against WCAG AA, on both surfaces and in
 * both schemes, parsed from the real stylesheets (docs/DESIGN.md 3.1).
 *
 * The numbers are derived from the CSS, never from a copy of the palette: a
 * table of hexes in TypeScript would pass forever while the CSS said something
 * else, and the only symptom would be somebody unable to read the page.
 *
 * The second half is the part specific to this product: the accent and the
 * danger red are USELESS against each other, and that is asserted rather than
 * assumed. It is the evidence that the ✕ and the sentence on every error are
 * load-bearing.
 */
import { describe, expect, it } from 'vitest';

import { AA_NORMAL, AA_UI, greyscale, ratio, resolve } from './contrast';
import { SURFACES } from './identity.test';

const BACKGROUNDS = ['--bg', '--surface', '--surface-2'] as const;
const TEXT_ON_BACKGROUNDS = ['--text', '--muted', '--accent', '--danger'] as const;
const PAIRS = [
  ['--accent-ink', '--accent'],
  ['--text', '--accent-soft'],
  ['--accent', '--accent-soft'],
  ['--danger', '--danger-soft'],
  // .respond-choice:checked keycap and .respond-scale-step:checked.
  ['--accent-ink', '--accent-hover'],
] as const;

const surfaces = Object.entries(SURFACES);

describe('text clears AA everywhere it is painted', () => {
  for (const [name, palette] of surfaces) {
    for (const foreground of TEXT_ON_BACKGROUNDS) {
      for (const background of BACKGROUNDS) {
        it(`${name}: ${foreground} on ${background}`, () => {
          const value = ratio(resolve(palette, foreground), resolve(palette, background));
          expect(
            value,
            `${name} ${foreground} on ${background} is ${String(value)}:1`,
          ).toBeGreaterThanOrEqual(AA_NORMAL);
        });
      }
    }
    for (const [foreground, background] of PAIRS) {
      it(`${name}: ${foreground} on ${background}`, () => {
        const value = ratio(resolve(palette, foreground), resolve(palette, background));
        expect(
          value,
          `${name} ${foreground} on ${background} is ${String(value)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    }
  }
});

describe('control edges and the focus ring clear 3:1', () => {
  for (const [name, palette] of surfaces) {
    for (const edge of ['--border', '--accent'] as const) {
      for (const background of BACKGROUNDS) {
        it(`${name}: ${edge} on ${background}`, () => {
          expect(
            ratio(resolve(palette, edge), resolve(palette, background)),
          ).toBeGreaterThanOrEqual(AA_UI);
        });
      }
    }
  }
});

describe('the accent and the danger red collapse, which is why errors carry words', () => {
  for (const [name, palette] of surfaces) {
    it(`${name}: under 1.3:1 in colour and under 3:1 in greyscale`, () => {
      const accent = resolve(palette, '--accent');
      const danger = resolve(palette, '--danger');
      expect(ratio(accent, danger)).toBeLessThan(1.3);
      expect(ratio(greyscale(accent), greyscale(danger))).toBeLessThan(AA_UI);
    });
  }
});

describe('chart marks (dataviz)', () => {
  for (const name of ['build light', 'build dark'] as const) {
    const palette = SURFACES[name];
    it(`${name}: single-series and NPS pole marks clear 3:1 on the card surface`, () => {
      for (const mark of ['--series-1', '--nps-detractor', '--nps-promoter'] as const) {
        expect(
          ratio(resolve(palette, mark), resolve(palette, '--surface')),
          mark,
        ).toBeGreaterThanOrEqual(AA_UI);
      }
    });
  }

  it('records the light passive grey below 3:1, which is why every NPS segment is labelled', () => {
    // The dataviz relief rule: a sub-3:1 mark is legal only with visible labels
    // or a table. Both exist (charts.tsx); pinning the number keeps the reason
    // visible if somebody later deletes the legend as clutter.
    const light = SURFACES['build light'];
    expect(ratio(resolve(light, '--nps-passive'), resolve(light, '--surface'))).toBe(2.38);
  });
});
