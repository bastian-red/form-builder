import type { FormDefinition } from '@forms/shared';
import { describe, expect, it } from 'vitest';

import { cell, exportFilename, exportRows, headers, type ExportRow } from './csv';

const DEFINITION: FormDefinition = {
  schemaVersion: 1,
  title: 'Café survey',
  ending: { title: 'Done', message: '' },
  fields: [
    { id: 'f_intro001', type: 'statement', title: 'Hello', required: false },
    {
      id: 'f_role0001',
      type: 'single_choice',
      title: 'Role',
      required: true,
      options: [
        { id: 'o_aaaaaaaa', label: 'Barista' },
        { id: 'o_bbbbbbbb', label: 'Guest' },
      ],
    },
    {
      id: 'f_tools001',
      type: 'multi_choice',
      title: 'Role',
      required: false,
      options: [
        { id: 'o_cccccccc', label: 'Grinder' },
        { id: 'o_dddddddd', label: 'Kettle' },
      ],
    },
    { id: 'f_again001', type: 'yes_no', title: 'Again?', required: true },
    { id: 'f_note0001', type: 'long_text', title: 'Note', required: false, maxLength: 500 },
  ],
};

async function* pages(...batches: ExportRow[][]): AsyncGenerator<ExportRow[]> {
  for (const batch of batches) yield batch;
}

async function collect(generator: AsyncGenerator<string>): Promise<string> {
  let out = '';
  for await (const chunk of generator) out += chunk;
  return out;
}

describe('cell', () => {
  it('neutralises every character a spreadsheet would execute', () => {
    for (const payload of ['=HYPERLINK("x")', '+1', '-1+2', '@SUM(A1)', '\tx', '\rx']) {
      expect(cell(payload).replace(/^"/u, '').startsWith("'"), payload).toBe(true);
    }
    expect(cell('plain')).toBe('plain');
  });

  it('quotes per RFC 4180, doubling inner quotes', () => {
    expect(cell('a,b')).toBe('"a,b"');
    expect(cell('say "hi"')).toBe('"say ""hi"""');
    expect(cell('two\nlines')).toBe('"two\nlines"');
    // Guard first, then quote: the guarded text is what gets quoted.
    expect(cell('=1,2')).toBe(`"'=1,2"`);
  });
});

describe('exportRows', () => {
  it('writes one header from the version and one line per response, in labels', async () => {
    const csv = await collect(
      exportRows(
        { version: 3, definition: DEFINITION },
        pages(
          [
            {
              id: 'r1',
              submittedAt: new Date('2026-10-01T10:00:00Z'),
              answers: {
                f_role0001: 'o_aaaaaaaa',
                f_tools001: ['o_dddddddd', 'o_cccccccc'],
                f_again001: false,
              },
            },
          ],
          [],
          [
            {
              id: 'r2',
              submittedAt: new Date('2026-10-02T10:00:00Z'),
              answers: { f_again001: true, f_note0001: '=cmd' },
            },
          ],
        ),
      ),
    );
    expect(csv).toBe(
      '\uFEFFresponse_id,version,submitted_at,Role,Role (2),Again?,Note\r\n' +
        'r1,3,2026-10-01T10:00:00.000Z,Barista,Kettle; Grinder,No,\r\n' +
        "r2,3,2026-10-02T10:00:00.000Z,,,Yes,'=cmd\r\n",
    );
  });

  it('skips statements, which never have an answer', () => {
    expect(headers(DEFINITION)).not.toContain('Hello');
  });
});

describe('exportFilename', () => {
  it('is ASCII and header-safe', () => {
    expect(exportFilename('Café survey: 2026!', 2)).toBe('cafe-survey-2026-v2.csv');
    expect(exportFilename('¿¿¿', 1)).toBe('responses-v1.csv');
  });
});
