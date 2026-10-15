'use client';

/**
 * The builder: the spine with its logic gutter, the inspector, the preview, and
 * the draft's life cycle.
 *
 * **Autosave.** Every change marks the draft unsaved; 700 ms after the last
 * change it is sent with the revision it was based on. Only one save is in
 * flight; a change during a save is sent when it returns. A 409 means another
 * tab saved in between, and the builder stops saving and says so rather than
 * overwriting that tab's work.
 *
 * **Issues.** The analyzer runs here on every change -- the same function the
 * API runs before publishing -- so a broken jump is drawn broken the moment it
 * is made, and Publish says why it is disabled.
 */
import { analyze, hasErrors } from '@forms/form-logic';
import type {
  AnalyzerIssue,
  Field,
  FieldType,
  FormDefinition,
  VersionSummary,
} from '@forms/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { publishAction, saveDraftAction } from '../../app/(build)/actions';
import {
  duplicateField,
  insertField,
  moveField,
  newField,
  removeField,
  updateField,
} from '../../lib/draft';
import { FormRunner } from '../respond/form-runner';
import { InsertPalette } from './insert-palette';
import { Inspector } from './inspector';
import { ENDING_ID, Spine } from './spine';

type SaveState = 'saved' | 'unsaved' | 'saving' | 'invalid' | 'conflict' | 'failed';

const SAVE_LABEL: Record<SaveState, { glyph: string; word: string }> = {
  saved: { glyph: '✓', word: 'Saved' },
  unsaved: { glyph: '•', word: 'Unsaved changes' },
  saving: { glyph: '↻', word: 'Saving' },
  invalid: { glyph: '⚠', word: 'Not saved: something is empty' },
  conflict: { glyph: '✕', word: 'Saved from another tab' },
  failed: { glyph: '✕', word: 'Not saved, retrying' },
};

interface Props {
  readonly formId: string;
  readonly slug: string;
  readonly initial: FormDefinition;
  readonly revision: number;
  readonly versions: readonly VersionSummary[];
  readonly unpublishedChanges: boolean;
  readonly publicUrl: string;
}

export function Builder({
  formId,
  slug,
  initial,
  revision: initialRevision,
  versions,
  unpublishedChanges,
  publicUrl,
}: Props) {
  const [definition, setDefinition] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial.fields[0]?.id ?? null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [palette, setPalette] = useState<{ open: boolean; at: number }>({ open: false, at: 0 });
  const [showPreview, setShowPreview] = useState(false);
  const [published, setPublished] = useState<{ version: number | null; dirty: boolean }>({
    version: versions.at(-1)?.version ?? null,
    dirty: unpublishedChanges,
  });
  const [publishOutcome, setPublishOutcome] = useState<{
    kind: 'ok' | 'error';
    text: string;
    issues: AnalyzerIssue[];
  } | null>(null);
  const [publishing, startPublish] = useTransition();

  const revision = useRef(initialRevision);
  const latest = useRef(definition);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const halted = useRef(false);

  // Set once React has attached the handlers. The server-rendered builder looks
  // identical before hydration, and a "/" pressed in that window does nothing;
  // the E2E suite waits on this attribute rather than on a timeout.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const issues = useMemo(() => analyze(definition), [definition]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const issuesByField = useMemo(() => {
    const map = new Map<string, AnalyzerIssue[]>();
    for (const issue of issues) {
      if (issue.fieldId === null) continue;
      map.set(issue.fieldId, [...(map.get(issue.fieldId) ?? []), issue]);
    }
    return map;
  }, [issues]);
  const broken = useMemo(
    () =>
      new Set(
        issues
          .filter(
            (issue) =>
              (issue.code === 'backward_jump' || issue.code === 'dangling_ref') &&
              issue.fieldId !== null &&
              issue.ref !== null,
          )
          .map((issue) => `${issue.fieldId!}->${issue.ref!}`),
      ),
    [issues],
  );

  // --- Autosave ---------------------------------------------------------------
  const flush = useCallback(async (): Promise<boolean> => {
    if (halted.current) return false;
    if (saving.current) return false;
    saving.current = true;
    setSaveState('saving');
    const sent = latest.current;
    const result = await saveDraftAction(formId, sent, revision.current);
    saving.current = false;
    if (result.ok) {
      revision.current = result.revision;
      setPublished((previous) => ({ ...previous, dirty: true }));
      if (latest.current !== sent) {
        // Changed while saving: send again.
        setSaveState('unsaved');
        return flush();
      }
      setSaveState('saved');
      setSaveMessage(null);
      return true;
    }
    setSaveMessage(result.message);
    if (result.reason === 'conflict') {
      halted.current = true;
      setSaveState('conflict');
    } else if (result.reason === 'invalid') {
      setSaveState('invalid');
    } else {
      setSaveState('failed');
      timer.current = setTimeout(() => void flush(), 4000);
    }
    return false;
  }, [formId]);

  const change = useCallback(
    (next: FormDefinition | ((previous: FormDefinition) => FormDefinition)) => {
      setDefinition((previous) => {
        const value = typeof next === 'function' ? next(previous) : next;
        latest.current = value;
        return value;
      });
      if (halted.current) return;
      setSaveState('unsaved');
      setPublishOutcome(null);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 700);
    },
    [flush],
  );

  // Leaving with unsaved work asks first.
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (saveState !== 'saved') event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [saveState]);

  // "/" opens the palette from anywhere that is not a text box.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
        return;
      event.preventDefault();
      const at = definition.fields.findIndex((field) => field.id === selectedId);
      setPalette({ open: true, at: at === -1 ? definition.fields.length : at + 1 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [definition.fields, selectedId]);

  // --- Edits ----------------------------------------------------------------------
  const selectedIndex = definition.fields.findIndex((field) => field.id === selectedId);
  const selected = selectedIndex === -1 ? undefined : definition.fields[selectedIndex];

  const insert = (type: FieldType, at: number) => {
    const field = newField(type);
    change((previous) => insertField(previous, at, field));
    setSelectedId(field.id);
  };

  const publish = () => {
    startPublish(async () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (saveState !== 'saved' && !(await flush())) {
        setPublishOutcome({
          kind: 'error',
          text: 'Save the draft first: it has unsaved changes that could not be saved.',
          issues: [],
        });
        return;
      }
      const outcome = await publishAction(formId);
      if (outcome.ok) {
        setPublished({ version: outcome.result.version, dirty: false });
        setPublishOutcome({
          kind: 'ok',
          text: outcome.result.created
            ? `Published version ${String(outcome.result.version)}. New respondents get it now.`
            : `Version ${String(outcome.result.version)} is already live; nothing changed.`,
          issues: outcome.result.warnings,
        });
      } else {
        setPublishOutcome({ kind: 'error', text: outcome.message, issues: outcome.issues });
      }
    });
  };

  const save = SAVE_LABEL[saveState];
  const status =
    published.version === null
      ? 'Never published'
      : published.dirty
        ? `Version ${String(published.version)} live, unpublished changes`
        : `Version ${String(published.version)} live`;

  return (
    <div
      className="builder"
      data-preview={showPreview || undefined}
      data-ready={ready || undefined}
    >
      <div className="builder-bar">
        <label className="builder-title-field">
          <span className="sr-only">Form title</span>
          <input
            className="builder-title"
            value={definition.title}
            maxLength={120}
            onChange={(event) => change((previous) => ({ ...previous, title: event.target.value }))}
          />
        </label>
        <p className="builder-save" data-state={saveState} role="status">
          <span aria-hidden="true">{save.glyph} </span>
          {save.word}
        </p>
        <p className="builder-status">{status}</p>
        <div className="builder-actions">
          {published.version === null ? null : (
            <>
              <Link className="button button-quiet" href={`/forms/${formId}/results`}>
                Results
              </Link>
              <a className="button button-quiet" href={`/f/${slug}`} target="_blank" rel="noopener">
                Open form<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </>
          )}
          <button
            className="button"
            type="button"
            aria-pressed={showPreview}
            onClick={() => setShowPreview((value) => !value)}
          >
            Preview
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={publish}
            disabled={publishing || hasErrors(issues) || saveState === 'conflict'}
            aria-describedby="publish-why"
          >
            {publishing ? 'Publishing' : 'Publish'}
          </button>
          <span id="publish-why" className="builder-why">
            {errors.length > 0 ? (
              <>
                <span aria-hidden="true">✕ </span>
                {errors.length === 1
                  ? '1 problem to fix'
                  : `${String(errors.length)} problems to fix`}
              </>
            ) : null}
          </span>
        </div>
      </div>

      {saveState === 'conflict' || saveState === 'invalid' || saveState === 'failed' ? (
        <div
          className={`notice builder-notice${saveState === 'conflict' ? ' notice-danger' : ''}`}
          role="alert"
        >
          <span aria-hidden="true">{save.glyph}</span>
          <span>{saveMessage}</span>
          {saveState === 'conflict' ? (
            <button className="button" type="button" onClick={() => window.location.reload()}>
              Reload the latest version
            </button>
          ) : null}
        </div>
      ) : null}

      {publishOutcome === null ? null : (
        <div
          className={`notice builder-notice${publishOutcome.kind === 'error' ? ' notice-danger' : ''}`}
          role="status"
        >
          <span aria-hidden="true">{publishOutcome.kind === 'ok' ? '✓' : '✕'}</span>
          <div>
            <p>{publishOutcome.text}</p>
            {publishOutcome.issues.length > 0 ? (
              <ul className="builder-issues">
                {publishOutcome.issues.map((issue, index) => (
                  <li key={index}>
                    <span aria-hidden="true">{issue.severity === 'error' ? '✕ ' : '⚠ '}</span>
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      )}

      <div className="builder-body">
        <section className="builder-sheet" aria-label="Questions and logic">
          {definition.fields.length === 0 ? (
            <div className="builder-empty">
              <p className="builder-empty-title">An empty sheet.</p>
              <p className="muted">
                Add the first question. Press <kbd>/</kbd> anywhere to choose its type.
              </p>
            </div>
          ) : null}
          <Spine
            definition={definition}
            selectedId={selectedId}
            issuesByField={issuesByField}
            broken={broken}
            onSelect={setSelectedId}
            onMove={(from, to) => change((previous) => moveField(previous, from, to))}
            onInsert={(at) => setPalette({ open: true, at })}
          />
        </section>

        <aside className="builder-side" aria-label={showPreview ? 'Preview' : 'Inspector'}>
          {showPreview ? (
            <div className="preview-frame">
              <FormRunner definition={definition} versionId={null} mode="preview" />
            </div>
          ) : selected !== undefined ? (
            <Inspector
              key={selected.id}
              field={selected}
              position={selectedIndex}
              definition={definition}
              onChange={(next: Field) =>
                change((previous) => updateField(previous, selected.id, () => next))
              }
              onDuplicate={() => {
                const { definition: next, copyId } = duplicateField(definition, selected.id);
                change(next);
                setSelectedId(copyId);
              }}
              onDelete={() => {
                const neighbour =
                  definition.fields[selectedIndex + 1] ?? definition.fields[selectedIndex - 1];
                change((previous) => removeField(previous, selected.id));
                setSelectedId(neighbour?.id ?? null);
              }}
              onInsertBelow={() => setPalette({ open: true, at: selectedIndex + 1 })}
            />
          ) : selectedId === ENDING_ID ? (
            <EndingEditor definition={definition} onChange={change} />
          ) : (
            <FormSettings
              definition={definition}
              onChange={change}
              publicUrl={publicUrl}
              published={published.version !== null}
            />
          )}
        </aside>
      </div>

      <InsertPalette
        open={palette.open}
        position={palette.at}
        onPick={(type) => insert(type, palette.at)}
        onClose={() => setPalette((previous) => ({ ...previous, open: false }))}
      />
    </div>
  );
}

function EndingEditor({
  definition,
  onChange,
}: {
  readonly definition: FormDefinition;
  readonly onChange: (next: FormDefinition) => void;
}) {
  return (
    <div className="inspector">
      <h2 className="inspector-title">Ending</h2>
      <section className="inspector-section" aria-label="Ending screen">
        <label className="field">
          <span className="field-label">Title</span>
          <input
            className="field-input"
            maxLength={120}
            value={definition.ending.title}
            onChange={(event) =>
              onChange({
                ...definition,
                ending: { ...definition.ending, title: event.target.value },
              })
            }
          />
        </label>
        <label className="field">
          <span className="field-label">Message</span>
          <textarea
            className="field-input"
            rows={3}
            maxLength={1000}
            value={definition.ending.message}
            onChange={(event) =>
              onChange({
                ...definition,
                ending: { ...definition.ending, message: event.target.value },
              })
            }
          />
        </label>
      </section>
    </div>
  );
}

function FormSettings({
  definition,
  onChange,
  publicUrl,
  published,
}: {
  readonly definition: FormDefinition;
  readonly onChange: (next: FormDefinition) => void;
  readonly publicUrl: string;
  readonly published: boolean;
}) {
  return (
    <div className="inspector">
      <h2 className="inspector-title">Form</h2>
      <section className="inspector-section" aria-label="Form settings">
        <label className="field">
          <span className="field-label">Welcome text</span>
          <span className="field-hint">
            When set, respondents see the title and this text before the first question.
          </span>
          <textarea
            className="field-input"
            rows={3}
            maxLength={1000}
            value={definition.description ?? ''}
            onChange={(event) => {
              const next = { ...definition };
              if (event.target.value === '') delete next.description;
              else next.description = event.target.value;
              onChange(next);
            }}
          />
        </label>
        <div className="field">
          <span className="field-label">Public link</span>
          <span className="field-hint">
            {published ? 'Share this with respondents.' : 'Live once you publish.'}
          </span>
          <code className="mono inspector-link">{publicUrl}</code>
        </div>
      </section>
      <p className="field-hint">
        Select a question on the sheet to edit it, or the Ending to edit the closing screen.
      </p>
    </div>
  );
}
