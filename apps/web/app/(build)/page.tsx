import { formListSchema, type FormSummary } from '@forms/shared';
import Link from 'next/link';

import { AppBar } from '../../components/app-bar';
import { CreateForm } from '../../components/create-form';
import { apiFetch } from '../../lib/api';
import { requireUser } from '../../lib/session';

export const metadata = { title: 'Your forms' };

/**
 * The author's forms, as a ledger: one ruled line per form, newest edit first.
 * Each line says what a respondent would see right now (live version, closed,
 * draft only) in a word beside its glyph, and how many people have answered.
 */
export default async function FormsPage() {
  const user = await requireUser('/');
  const forms = await apiFetch(user, '/forms', formListSchema);

  return (
    <>
      <AppBar user={user} />
      <main id="main" className="forms-page">
        <header className="forms-head">
          <h1 className="forms-title">Your forms</h1>
          <CreateForm />
        </header>
        {forms.length === 0 ? (
          <p className="forms-empty">No forms yet. Name one above to open the builder.</p>
        ) : (
          <ol className="forms-ledger">
            {forms.map((form) => (
              <FormLine key={form.id} form={form} />
            ))}
          </ol>
        )}
      </main>
    </>
  );
}

function FormLine({ form }: { readonly form: FormSummary }) {
  const state =
    form.latestVersion === null
      ? { glyph: '○', word: 'Draft only' }
      : form.accepting
        ? { glyph: '●', word: `Live, version ${String(form.latestVersion)}` }
        : { glyph: '■', word: 'Closed' };
  return (
    <li className="forms-line">
      <div className="forms-line-main">
        <Link className="forms-line-title" href={`/forms/${form.id}/edit`}>
          {form.title}
        </Link>
        <p className="forms-line-meta">
          <span
            className="forms-state"
            data-state={form.latestVersion === null ? 'draft' : form.accepting ? 'live' : 'closed'}
          >
            <span aria-hidden="true">{state.glyph} </span>
            {state.word}
          </span>
          {form.unpublishedChanges && form.latestVersion !== null ? (
            <span>Unpublished changes</span>
          ) : null}
          <span>
            Edited{' '}
            <time dateTime={form.updatedAt}>
              {new Date(form.updatedAt).toISOString().slice(0, 10)}
            </time>
          </span>
        </p>
      </div>
      <p className="forms-line-count">
        <span className="mono">{form.responses}</span>{' '}
        {form.responses === 1 ? 'response' : 'responses'}
      </p>
      <nav className="forms-line-links" aria-label={`${form.title}`}>
        <Link href={`/forms/${form.id}/edit`}>Edit</Link>
        {form.latestVersion === null ? null : (
          <Link href={`/forms/${form.id}/results`}>Results</Link>
        )}
        {form.latestVersion === null ? null : (
          <Link href={`/f/${form.slug}`} target="_blank" rel="noopener">
            Open form<span className="sr-only"> (opens in a new tab)</span>
          </Link>
        )}
      </nav>
    </li>
  );
}
