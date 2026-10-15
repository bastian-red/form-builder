/**
 * The report's charts, as server-rendered HTML and SVG (docs/DESIGN.md 3.2).
 *
 * Built to the dataviz procedure:
 *
 * - **Form by job.** Choices are horizontal bars (nominal: one colour, slot 1,
 *   for every bar); ratings, NPS scores and number histograms are columns on a
 *   pinned domain; yes/no is a meter; NPS adds a diverging stacked bar
 *   (detractors red, passives grey, promoters blue); text is text.
 * - **Values are printed.** Count and share sit at the end of every bar, so the
 *   hover readout only ever repeats them, and every chart has a `<details>`
 *   table holding the same numbers.
 * - **Text never wears a series colour.** Labels and values use text tokens; the
 *   coloured mark beside them carries identity.
 * - **Marks are thin**: bars at most 24px, 4px rounded data ends, square at the
 *   baseline, a 2px surface gap between stacked segments.
 *
 * No chart is `aria-hidden` as a whole. The bar lists are real lists whose rows
 * read "Engineer, 412, 46%"; the SVG columns carry a `<title>` per column and
 * are summarised by the table.
 */
import type { FieldResult, FieldResultBody, FunnelStep } from '@forms/shared';

export function percent(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${String(Math.round((part / whole) * 100))}%`;
}

/** A compact count for axis ticks and tips: 1,284 stays whole, 12,900 becomes 12.9K. */
export function compact(value: number): string {
  if (Math.abs(value) < 10_000) return value.toLocaleString('en-US');
  return `${(value / 1000).toFixed(1).replace(/\.0$/u, '')}K`;
}

function TableView({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: readonly string[];
  rows: ReadonlyArray<ReadonlyArray<string | number>>;
}) {
  return (
    <details className="chart-table">
      <summary>Show as a table</summary>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) =>
                column === 0 ? (
                  <th key={column} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={column} className="mono">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Horizontal bars with the value at the tip. Used for choices and the funnel. */
export function BarList({
  rows,
  whole,
  label,
}: {
  rows: ReadonlyArray<{ key: string; label: string; count: number }>;
  whole: number;
  label: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ul className="bars" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className="bar-row">
          <span className="bar-label">{row.label}</span>
          <span className="bar-track">
            <span className="bar" style={{ inlineSize: `${String((row.count / max) * 100)}%` }} />
            <span className="bar-value">
              <span className="mono">{compact(row.count)}</span>{' '}
              <span className="bar-share">{percent(row.count, whole)}</span>
            </span>
          </span>
          <span className="bar-tip" aria-hidden="true">
            <strong className="mono">{row.count.toLocaleString('en-US')}</strong> {row.label},{' '}
            {percent(row.count, whole)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Columns on a fixed set of x values (1..N, 0..10, histogram bins). */
export function Columns({
  columns,
  label,
  tone,
}: {
  columns: ReadonlyArray<{
    key: string;
    label: string;
    count: number;
    tone?: 'detractor' | 'passive' | 'promoter';
  }>;
  label: string;
  tone?: 'nps';
}) {
  const max = Math.max(1, ...columns.map((column) => column.count));
  const width = 100 / Math.max(1, columns.length);
  return (
    <figure className="columns" data-tone={tone}>
      <svg
        className="columns-plot"
        viewBox="0 0 100 60"
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <line x1="0" x2="100" y1="60" y2="60" className="columns-baseline" />
        {columns.map((column, index) => {
          const height = (column.count / max) * 56;
          const barWidth = Math.min(width - 1.2, 9);
          const x = index * width + (width - barWidth) / 2;
          return (
            <rect
              key={column.key}
              className="column"
              data-tone={column.tone}
              x={x}
              y={60 - height}
              width={barWidth}
              height={height}
              rx={0.8}
            >
              <title>{`${column.label}: ${String(column.count)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="columns-axis" aria-hidden="true">
        {columns.map((column) => (
          <span key={column.key} className="columns-tick">
            <span className="mono">{column.label}</span>
            <span className="columns-count mono">{compact(column.count)}</span>
          </span>
        ))}
      </div>
    </figure>
  );
}

function NpsSplit({ result }: { result: Extract<FieldResultBody, { kind: 'nps' }> }) {
  const total = result.detractors + result.passives + result.promoters;
  const parts = [
    { key: 'detractor', word: 'Detractors', range: '0–6', glyph: '▼', count: result.detractors },
    { key: 'passive', word: 'Passives', range: '7–8', glyph: '■', count: result.passives },
    { key: 'promoter', word: 'Promoters', range: '9–10', glyph: '▲', count: result.promoters },
  ] as const;
  return (
    <div className="nps">
      <p className="nps-score">
        <span className="nps-score-value">
          {result.score === null
            ? '—'
            : result.score > 0
              ? `+${String(result.score)}`
              : String(result.score)}
        </span>
        <span className="nps-score-label">Net Promoter Score</span>
      </p>
      <div
        className="nps-bar"
        role="img"
        aria-label={parts.map((part) => `${part.word} ${percent(part.count, total)}`).join(', ')}
      >
        {parts.map((part) =>
          part.count === 0 ? null : (
            <span
              key={part.key}
              className="nps-segment"
              data-tone={part.key}
              style={{ flexGrow: part.count }}
            />
          ),
        )}
      </div>
      <ul className="nps-legend">
        {parts.map((part) => (
          <li key={part.key}>
            <span className="nps-swatch" data-tone={part.key} aria-hidden="true" />
            <span aria-hidden="true">{part.glyph} </span>
            {part.word} <span className="muted">({part.range})</span>{' '}
            <span className="mono">{part.count}</span>{' '}
            <span className="muted">{percent(part.count, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FieldChart({ field }: { field: FieldResult }) {
  const result = field.result;
  switch (result.kind) {
    case 'choice': {
      const whole = result.multiple
        ? field.answered
        : result.options.reduce((sum, option) => sum + option.count, 0);
      return (
        <>
          <BarList
            label={`${field.title}: answers`}
            whole={whole}
            rows={result.options.map((option) => ({
              key: option.optionId,
              label: option.label,
              count: option.count,
            }))}
          />
          {result.multiple ? (
            <p className="chart-note">
              Respondents could choose several; shares are of the {field.answered} who answered.
            </p>
          ) : null}
          <TableView
            caption={field.title}
            head={['Option', 'Responses', 'Share']}
            rows={result.options.map((option) => [
              option.label,
              option.count,
              percent(option.count, whole),
            ])}
          />
        </>
      );
    }
    case 'scale': {
      return (
        <>
          <p className="chart-headline">
            <span className="chart-headline-value">
              {result.mean === null ? '—' : result.mean.toFixed(1)}
            </span>
            <span className="chart-headline-label">average of {result.distribution.length}</span>
          </p>
          <Columns
            label={`${field.title}: distribution`}
            columns={result.distribution.map((step) => ({
              key: String(step.value),
              label: String(step.value),
              count: step.count,
            }))}
          />
          <TableView
            caption={field.title}
            head={['Rating', 'Responses']}
            rows={result.distribution.map((step) => [step.value, step.count])}
          />
        </>
      );
    }
    case 'nps':
      return (
        <>
          <NpsSplit result={result} />
          <Columns
            label={`${field.title}: scores 0 to 10`}
            tone="nps"
            columns={result.distribution.map((step) => ({
              key: String(step.value),
              label: String(step.value),
              count: step.count,
              tone: step.value >= 9 ? 'promoter' : step.value >= 7 ? 'passive' : 'detractor',
            }))}
          />
          <TableView
            caption={field.title}
            head={['Score', 'Responses']}
            rows={result.distribution.map((step) => [step.value, step.count])}
          />
        </>
      );
    case 'number': {
      const bin = (from: number, to: number) =>
        from === to ? String(from) : `${trim(from)}–${trim(to)}`;
      return (
        <>
          <dl className="stat-row">
            {[
              ['Median', result.median],
              ['Mean', result.mean],
              ['Min', result.min],
              ['Max', result.max],
            ].map(([name, value]) => (
              <div key={name as string}>
                <dt>{name}</dt>
                <dd className="mono">{value === null ? '—' : trim(value as number)}</dd>
              </div>
            ))}
          </dl>
          {result.bins.length === 0 ? null : (
            <Columns
              label={`${field.title}: histogram`}
              columns={result.bins.map((b) => ({
                key: `${String(b.from)}-${String(b.to)}`,
                label: bin(b.from, b.to),
                count: b.count,
              }))}
            />
          )}
          <TableView
            caption={field.title}
            head={['Range', 'Responses']}
            rows={result.bins.map((b) => [bin(b.from, b.to), b.count])}
          />
        </>
      );
    }
    case 'boolean': {
      const total = result.yes + result.no;
      return (
        <>
          <div
            className="meter"
            role="img"
            aria-label={`Yes ${percent(result.yes, total)}, No ${percent(result.no, total)}`}
          >
            <span
              className="meter-fill"
              style={{ inlineSize: total === 0 ? '0%' : `${String((result.yes / total) * 100)}%` }}
            />
          </div>
          <p className="meter-legend">
            <span>
              <span aria-hidden="true">✓ </span>Yes <span className="mono">{result.yes}</span>{' '}
              <span className="muted">{percent(result.yes, total)}</span>
            </span>
            <span>
              <span aria-hidden="true">✕ </span>No <span className="mono">{result.no}</span>{' '}
              <span className="muted">{percent(result.no, total)}</span>
            </span>
          </p>
        </>
      );
    }
    case 'text':
      return result.latest.length === 0 ? (
        <p className="muted">No answers yet.</p>
      ) : (
        <ul className="quotes" aria-label={`Latest answers to ${field.title}`}>
          {result.latest.map((answer, index) => (
            <li key={index} className="quote">
              <p>{answer.value}</p>
              <time className="quote-time mono" dateTime={answer.submittedAt}>
                {answer.submittedAt.slice(0, 16).replace('T', ' ')} UTC
              </time>
            </li>
          ))}
        </ul>
      );
    case 'date':
      return (
        <dl className="stat-row">
          <div>
            <dt>Earliest</dt>
            <dd className="mono">{result.earliest ?? '—'}</dd>
          </div>
          <div>
            <dt>Latest</dt>
            <dd className="mono">{result.latest ?? '—'}</dd>
          </div>
        </dl>
      );
  }
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function Funnel({ steps, started }: { steps: readonly FunnelStep[]; started: number }) {
  return (
    <>
      <BarList
        label="Responses that reached each question"
        whole={started}
        rows={steps.map((step, index) => ({
          key: step.fieldId,
          label: `${String(index + 1)}. ${step.title}`,
          count: step.reached,
        }))}
      />
      <TableView
        caption="Completion funnel"
        head={['Question', 'Reached', 'Share of starts']}
        rows={steps.map((step, index) => [
          `${String(index + 1)}. ${step.title}`,
          step.reached,
          percent(step.reached, started),
        ])}
      />
    </>
  );
}
