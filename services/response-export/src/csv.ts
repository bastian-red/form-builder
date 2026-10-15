/**
 * CSV export of one form version (docs/SPECS.md 8).
 *
 * Three properties, each with the mechanism that holds it:
 *
 * - **Columns come from the version the responses were answered on.** Editing a
 *   question never renames or drops a column in an old export, because the
 *   columns are read from that version's definition, not from the draft.
 * - **A cell cannot become a formula.** Spreadsheet apps execute a cell that
 *   starts with `=`, `+`, `-`, `@`, a tab or a carriage return (OWASP "CSV
 *   injection"). Any such cell is prefixed with `'`, which every spreadsheet
 *   treats as "this is text". Respondents are strangers; the person opening the
 *   file is the form's owner.
 * - **It streams.** `exportRows` is an async generator over an async source of
 *   rows, so the caller can write 100,000 responses to the socket in constant
 *   memory instead of building one string.
 */
import type { AnswerValue, Field, FormDefinition } from '@forms/shared';
import { isAnswerable } from '@forms/shared';

const FORMULA_START = /^[=+\-@\t\r]/u;

/** One cell: guarded against formula execution, then RFC 4180 quoted when needed. */
export function cell(raw: string): string {
  const guarded = FORMULA_START.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/u.test(guarded) ? `"${guarded.replace(/"/gu, '""')}"` : guarded;
}

export function line(cells: readonly string[]): string {
  return `${cells.map(cell).join(',')}\r\n`;
}

/** Column headers: question titles, made unique with " (2)", " (3)". */
export function headers(definition: FormDefinition): string[] {
  const seen = new Map<string, number>();
  const titles = definition.fields.filter(isAnswerable).map((field) => {
    const base = field.title.trim();
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${String(n)})`;
  });
  return ['response_id', 'version', 'submitted_at', ...titles];
}

/** One answer as the text a person reading the sheet expects: labels, not ids. */
export function display(field: Field, value: AnswerValue | undefined): string {
  if (value === undefined) return '';
  if (field.type === 'single_choice') {
    return field.options.find((option) => option.id === value)?.label ?? String(value);
  }
  if (field.type === 'multi_choice' && Array.isArray(value)) {
    return value
      .map((id) => field.options.find((option) => option.id === id)?.label ?? id)
      .join('; ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export interface ExportRow {
  readonly id: string;
  readonly submittedAt: Date;
  readonly answers: Record<string, AnswerValue>;
}

export async function* exportRows(
  version: { version: number; definition: FormDefinition },
  rows: AsyncIterable<readonly ExportRow[]>,
): AsyncGenerator<string> {
  const fields = version.definition.fields.filter(isAnswerable);
  // A UTF-8 byte order mark, so Excel opens accented answers as UTF-8 instead
  // of guessing Windows-1252 and showing "Ã©" for "é". Every other reader
  // ignores it.
  yield `\uFEFF${line(headers(version.definition))}`;
  for await (const page of rows) {
    let chunk = '';
    for (const row of page) {
      chunk += line([
        row.id,
        String(version.version),
        row.submittedAt.toISOString(),
        ...fields.map((field) => display(field, row.answers[field.id])),
      ]);
    }
    if (chunk !== '') yield chunk;
  }
}

/** `form-title-v2.csv`: ASCII, lowercase, safe in a Content-Disposition header. */
export function exportFilename(title: string, version: number): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  return `${slug === '' ? 'responses' : slug}-v${String(version)}.csv`;
}
