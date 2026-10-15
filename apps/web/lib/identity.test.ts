import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractTokens, resolve, stripCssComments } from './contrast';

/**
 * The identity lock (docs/DESIGN.md 3): the drafting sheet and the respondent's
 * page, pinned.
 *
 * Read out of the real stylesheets and `app/layout.tsx`. What breaks without it
 * is the portfolio's actual failure mode: every project drifting toward whatever
 * the last one wore. A redesign that drifts compiles, renders, and passes every
 * other test. Changing an identity means editing this file deliberately.
 */
const APP = join(__dirname, '..', 'app');
const globals = stripCssComments(readFileSync(join(APP, 'globals.css'), 'utf8'));
const respondCss = stripCssComments(readFileSync(join(APP, 'respond.css'), 'utf8'));
const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');

const DARK = '@media (prefers-color-scheme: dark)';
const RESPOND = "[data-surface='respond']";

export const SURFACES = {
  'build light': extractTokens(globals, ':root'),
  'build dark': { ...extractTokens(globals, ':root'), ...extractTokens(globals, DARK) },
  'respond light': { ...extractTokens(globals, ':root'), ...extractTokens(respondCss, RESPOND) },
  'respond dark': {
    ...extractTokens(globals, ':root'),
    ...extractTokens(globals, DARK),
    ...extractTokens(respondCss, RESPOND),
    ...extractTokens(respondCss, DARK),
  },
} as const;

const IDENTITY = {
  'build light': { '--bg': '#ffffff', '--accent': '#4d5c00', '--radius': '3px' },
  'build dark': { '--bg': '#1b1b1d', '--accent': '#b9c95a', '--radius': '3px' },
  'respond light': { '--bg': '#fbf3ea', '--accent': '#8a5a00', '--radius': '16px' },
  'respond dark': { '--bg': '#1b1714', '--accent': '#e6b450', '--radius': '16px' },
} as const;

const FONTS = ['Geist_Mono', 'Hanken_Grotesk', 'Lora'];

/**
 * The faces from `next/font/google`, with the same regex
 * `web/scripts/identity-distinct.mjs` uses. ONE import, single-quoted: split it or
 * double-quote it and the cross-repo check reads zero faces from this project and
 * reports success while checking nothing.
 */
function importedFaces(): string[] {
  const line = /import\s*\{([^}]*)\}\s*from\s*'next\/font\/google'/.exec(layout);
  if (!line) throw new Error('layout.tsx imports nothing from next/font/google');
  return line[1]!
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
}

describe('visual identity', () => {
  for (const [surface, tokens] of Object.entries(IDENTITY)) {
    it.each(Object.entries(tokens))(`${surface}: %s is %s`, (token, expected) => {
      const palette = SURFACES[surface as keyof typeof SURFACES];
      const value = token === '--radius' ? palette[token] : resolve(palette, token).toLowerCase();
      expect(value).toBe(expected);
    });
  }

  it('gives the two surfaces different canvases, accents and corners', () => {
    // One product, two audiences: the author's tool and the respondent's page
    // must not look like each other.
    expect(SURFACES['respond light']['--bg']).not.toBe(SURFACES['build light']['--bg']);
    expect(SURFACES['respond light']['--accent']).not.toBe(SURFACES['build light']['--accent']);
    expect(SURFACES['respond light']['--radius']).not.toBe(SURFACES['build light']['--radius']);
  });

  it('loads exactly the faces this identity is built on', () => {
    expect(importedFaces()).toEqual(FONTS);
  });

  it('keeps the one font import in the shape the cross-repo check can parse', () => {
    const imports = [...layout.matchAll(/from\s*['"]next\/font\/google['"]/g)];
    expect(imports, 'exactly one next/font/google import statement').toHaveLength(1);
  });

  it('wires each face to the variable the stylesheet reads', () => {
    for (const variable of ['--font-question', '--font-ui', '--font-mono']) {
      expect(layout).toContain(`variable: '${variable}'`);
    }
  });

  it('does not reintroduce the shared signal red or the banned generator tics', () => {
    for (const css of [globals, respondCss]) {
      expect([...css.matchAll(/#ff0000|#f00\b/gi)]).toHaveLength(0);
      expect(css).not.toMatch(/--ff-dot|--dot-grid|--font-dot/);
    }
  });
});

/**
 * What the rest of the portfolio already spent. `web/scripts/identity-distinct.mjs`
 * is the authority (it reads the siblings' real stylesheets); this is the half a
 * single repo can check inside its own pre-commit gate.
 */
const SPENT = {
  canvases: [
    '#fafaf8',
    '#101319', // 001
    '#fffdfa',
    '#14120e',
    '#f6f7f9',
    '#0d1117', // 002
    '#f8fafc',
    '#0b1220',
    '#fbf8f3',
    '#14120f', // 003
    '#f7f6fb',
    '#12111a', // 004
    '#ecedf0',
    '#191621', // 005
    '#f4f1e8',
    '#15191c', // 006
    '#e4e8e0',
    '#171b17', // 007
  ],
  accents: [
    '#4f46e5',
    '#818cf8', // 001
    '#7a2e2e',
    '#e39a9a',
    '#1f6feb',
    '#58a6ff', // 002
    '#1d4ed8',
    '#60a5fa',
    '#0f766e',
    '#5eead4', // 003
    '#6d28d9',
    '#a78bfa', // 004
    '#a01a6d',
    '#f4a3d6', // 005
    '#0d6b85',
    '#63c9e6', // 006
    '#1a6b3c',
    '#6fca90', // 007
  ],
  faces: [
    'Fraunces',
    'Inter', // 001
    'Archivo',
    'IBM_Plex_Mono',
    'Instrument_Serif', // 002
    'IBM_Plex_Sans',
    'JetBrains_Mono',
    'Source_Serif_4', // 003
    'Newsreader',
    'Public_Sans',
    'Roboto_Mono', // 004
    'DM_Mono',
    'Manrope',
    'Sora', // 005
    'Azeret_Mono',
    'Figtree',
    'Literata', // 006
    'Karla',
    'Red_Hat_Mono',
    'Spectral', // 007
  ],
  radii: ['10px', '2px', '6px', '4px', '12px'],
} as const;

describe('no two projects share an identity', () => {
  it.each(Object.keys(SURFACES))(
    '%s: the canvas and the accent are this project alone',
    (surface) => {
      const palette = SURFACES[surface as keyof typeof SURFACES];
      expect(SPENT.canvases).not.toContain(resolve(palette, '--bg').toLowerCase());
      expect(SPENT.accents).not.toContain(resolve(palette, '--accent').toLowerCase());
    },
  );

  it('loads no typeface another project already uses', () => {
    expect(
      importedFaces().filter((face) => (SPENT.faces as readonly string[]).includes(face)),
    ).toEqual([]);
  });

  it('uses primary radii no sibling uses', () => {
    for (const surface of Object.values(SURFACES)) {
      expect(SPENT.radii as readonly string[]).not.toContain(surface['--radius']);
    }
  });
});
