import {
  formDetailSchema,
  idSchema,
  responsesPageSchema,
  resultsSchema,
  type Field,
  type FormDefinition,
  type ResponsesPage,
  type Results,
} from '@forms/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AppBar } from '../../../../../components/app-bar';
import { FieldChart, Funnel, percent } from '../../../../../components/results/charts';
import { AcceptingToggle } from '../../../../../components/results/accepting-toggle';
import { ApiError, apiFetch, query } from '../../../../../lib/api';
import { requireUser } from '../../../../../lib/session';

export const metadata = { title: 'Results' };

type Search = Promise<{ version?: string; filter?: string; tab?: string; cursor?: string }>;

/** The filter travels as one select value: `fieldId:value`. */
function splitFilter(raw: string | undefined): { field: string; value: string } | null {
  if (raw === undefined || raw === '') return null;
  const at = raw.indexOf(':');
  return at === -1 ? null : { field: raw.slice(0, at), value: raw.slice(at + 1) };
}

/** The answers a report can be sliced by: every value of every categorical question. */
function filterChoices(
  definition: FormDefinition,
): Array<{ group: string; options: Array<{ value: string; label: string }> }> {
  const groups: Array<{ group: string; options: Array<{ value: string; label: string }> }> = [];
  for (const field of definition.fields) {
    let options: Array<{ value: string; label: string }> = [];
    if (field.type === 'single_choice' || field.type === 'multi_choice') {
      options = field.options.map((option) => ({
        value: `${field.id}:${option.id}`,
        label: option.label,
      }));
    } else if (field.type === 'yes_no') {
      options = [
        { value: `${field.id}:true`, label: 'Yes' },
        { value: `${field.id}:false`, label: 'No' },
      ];
    } else if (field.type === 'nps' || field.type === 'rating') {
      const [low, high] = field.type === 'nps' ? [0, 10] : [1, field.scale];
      options = Array.from({ length: high - low + 1 }, (_, i) => ({
        value: `${field.id}:${String(low + i)}`,
        label: String(low + i),
      }));
    }
    if (options.length > 0) groups.push({ group: field.title, options });
  }
  return groups;
}

function display(field: Field, value: unknown): string {
  if (value === undefined) return '';
  if (field.type === 'single_choice')
    return field.options.find((option) => option.id === value)?.label ?? String(value);
  if (field.type === 'multi_choice' && Array.isArray(value)) {
    return value
      .map((id) => field.options.find((option) => option.id === id)?.label ?? String(id))
      .join('; ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes === 0
    ? `${String(rest)} s`
    : `${String(minutes)} min ${String(rest).padStart(2, '0')} s`;
}

/**
 * The report (docs/DESIGN.md 6): a KPI row, the filters that scope everything
 * below them, the completion funnel, then one card per question in form order.
 * The second tab is the response table and the CSV download.
 *
 * Everything is server-rendered from the API's numbers; the filter row is a
 * plain GET form, so the report works before (and without) JavaScript and every
 * view has a URL that can be sent to a colleague.
 */
export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Search;
}) {
  const { id } = await params;
  const search = await searchParams;
  const user = await requireUser(`/forms/${id}/results${query({ ...search })}`);
  if (!idSchema.safeParse(id).success) notFound();

  const filter = splitFilter(search.filter);
  const version = search.version && /^\d{1,6}$/u.test(search.version) ? search.version : undefined;

  let detail;
  let results: Results;
  try {
    [detail, results] = await Promise.all([
      apiFetch(user, `/forms/${id}`, formDetailSchema),
      apiFetch(
        user,
        `/forms/${id}/results${query({ version, filterField: filter?.field, filterValue: filter?.value })}`,
        resultsSchema,
      ),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    if (error instanceof ApiError && error.status === 400) {
      // A filter that does not belong to this version: drop it rather than fail.
      results = await apiFetch(user, `/forms/${id}/results${query({ version })}`, resultsSchema);
      detail = await apiFetch(user, `/forms/${id}`, formDetailSchema);
    } else throw error;
  }

  // The definition the report is ABOUT: the version's, not the draft's.
  const versionRow = detail.versions.find((row) => row.version === results.version);
  const tab = search.tab === 'responses' ? 'responses' : 'report';
  const base = `/forms/${id}/results`;
  const keep = { version: String(results.version), filter: search.filter };

  return (
    <>
      <AppBar
        user={user}
        trail={[{ label: detail.draft.title, href: `/forms/${id}/edit` }, { label: 'Results' }]}
      />
      <main id="main" className="results-page">
        <header className="results-head">
          <div>
            <h1 className="results-title">{detail.draft.title}</h1>
            <p className="muted">
              Version <span className="mono">{results.version}</span>, published{' '}
              <time dateTime={versionRow?.publishedAt}>{versionRow?.publishedAt.slice(0, 10)}</time>
            </p>
          </div>
          <AcceptingToggle formId={id} accepting={detail.accepting} />
        </header>

        <form className="results-filters" method="get" action={base}>
          <label className="field">
            <span className="field-label">Version</span>
            <select className="field-input" name="version" defaultValue={String(results.version)}>
              {[...results.versions].reverse().map((row) => (
                <option key={row.id} value={row.version}>
                  Version {row.version} ({row.responses} completed)
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Only respondents who answered</span>
            <select
              className="field-input"
              name="filter"
              defaultValue={
                results.filter ? `${results.filter.fieldId}:${String(results.filter.value)}` : ''
              }
            >
              <option value="">Everyone</option>
              {filterChoices(results.definition).map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {tab === 'responses' ? <input type="hidden" name="tab" value="responses" /> : null}
          <button className="button" type="submit">
            Apply
          </button>
          {results.filter ? (
            <Link
              className="button button-quiet"
              href={`${base}${query({ version: String(results.version), tab: tab === 'responses' ? 'responses' : undefined })}`}
            >
              Clear filter
            </Link>
          ) : null}
        </form>

        <nav className="results-tabs" aria-label="Results views">
          <Link href={`${base}${query(keep)}`} aria-current={tab === 'report' ? 'page' : undefined}>
            Report
          </Link>
          <Link
            href={`${base}${query({ ...keep, tab: 'responses' })}`}
            aria-current={tab === 'responses' ? 'page' : undefined}
          >
            Responses
          </Link>
          <a
            className="results-export"
            href={`/forms/${id}/export${query({ version: String(results.version) })}`}
            download
          >
            Download CSV<span className="sr-only">, version {results.version}</span>
          </a>
        </nav>

        {tab === 'report' ? (
          <Report results={results} />
        ) : (
          <ResponsesTab
            formId={id}
            user={user}
            results={results}
            cursor={search.cursor}
            keep={keep}
          />
        )}
      </main>
    </>
  );
}

function Report({ results }: { results: Results }) {
  const { totals } = results;
  return (
    <>
      <dl className="kpis">
        <div className="kpi">
          <dt>Started</dt>
          <dd>{totals.started.toLocaleString('en-US')}</dd>
        </div>
        <div className="kpi">
          <dt>Completed</dt>
          <dd>{totals.completed.toLocaleString('en-US')}</dd>
        </div>
        <div className="kpi">
          <dt>Completion rate</dt>
          <dd>{percent(totals.completed, totals.started)}</dd>
        </div>
        <div className="kpi">
          <dt>Median time to complete</dt>
          <dd>{duration(totals.medianSecondsToComplete)}</dd>
        </div>
      </dl>
      {results.filter ? (
        <p className="notice">
          <span aria-hidden="true">◇</span> Showing only respondents who gave the chosen answer.
          Filtered reports are computed from the responses and cached.
        </p>
      ) : null}

      <section className="report-card" aria-labelledby="funnel-title">
        <h2 id="funnel-title" className="report-card-title">
          Where people stop
        </h2>
        <p className="report-card-meta">
          Responses that reached each question, of {totals.started.toLocaleString('en-US')} started.
        </p>
        <Funnel
          steps={results.funnel.filter((step) => step.reached > 0 || totals.started === 0)}
          started={totals.started}
        />
      </section>

      {results.fields.map((field, index) => (
        <section
          key={field.fieldId}
          className="report-card"
          aria-labelledby={`card-${field.fieldId}`}
        >
          <p className="report-card-number mono" aria-hidden="true">
            {index + 1}
          </p>
          <h2 id={`card-${field.fieldId}`} className="report-card-title">
            {field.title}
          </h2>
          <p className="report-card-meta">
            {field.answered.toLocaleString('en-US')} answered
            {field.reached > 0 ? ` of ${field.reached.toLocaleString('en-US')} who saw it` : ''}
          </p>
          <FieldChart field={field} />
        </section>
      ))}
    </>
  );
}

async function ResponsesTab({
  formId,
  user,
  results,
  cursor,
  keep,
}: {
  formId: string;
  user: Parameters<typeof apiFetch>[0];
  results: Results;
  cursor: string | undefined;
  keep: Record<string, string | undefined>;
}) {
  const page: ResponsesPage = await apiFetch(
    user,
    `/forms/${formId}/responses${query({ version: String(results.version), cursor })}`,
    responsesPageSchema,
  );
  const columns = results.definition.fields.filter((field) => field.type !== 'statement');
  return (
    <section className="responses" aria-labelledby="responses-title">
      <h2 id="responses-title" className="report-card-title">
        {page.total.toLocaleString('en-US')} completed responses
      </h2>
      <div
        className="responses-scroll"
        tabIndex={0}
        role="region"
        aria-label="Responses table, scrolls sideways"
      >
        <table className="responses-table">
          <thead>
            <tr>
              <th scope="col">Submitted (UTC)</th>
              {columns.map((field) => (
                <th key={field.id} scope="col">
                  {field.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="mono">
                  {row.submittedAt.slice(0, 16).replace('T', ' ')}
                </th>
                {columns.map((field) => (
                  <td key={field.id}>{display(field, row.answers[field.id])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="responses-pager" aria-label="Pages">
        {cursor === undefined ? null : (
          <Link
            className="button"
            href={`/forms/${formId}/results${query({ ...keep, tab: 'responses' })}`}
          >
            First page
          </Link>
        )}
        {page.next === null ? null : (
          <Link
            className="button"
            href={`/forms/${formId}/results${query({ ...keep, tab: 'responses', cursor: page.next })}`}
          >
            Next page
          </Link>
        )}
      </nav>
    </section>
  );
}
