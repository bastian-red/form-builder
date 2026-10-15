'use client';

/**
 * One question, the whole screen (docs/DESIGN.md 5).
 *
 * The respondent moves with `@forms/form-logic`'s navigator: the same code the
 * server runs to decide which questions a set of answers may contain, so the
 * path a respondent walks here is by construction one the API accepts
 * (`navigator.property.test.ts` holds that over thousands of generated forms).
 *
 * In `live` mode every Next sends the answers so far (a partial save, not
 * awaited, latest-wins) and the last one sends them complete. The response id is
 * minted here, in the browser, which is what makes a retried save the same row.
 * Progress survives a reload in sessionStorage, which is a convenience: it can
 * be empty or unavailable and the form still works.
 *
 * In `preview` mode (the builder) nothing is sent anywhere.
 */
import {
  answerProblem,
  firstField,
  isAnswered,
  nextField,
  progress,
  requiredMessage,
  submission,
} from '@forms/form-logic';
import type { AnswerProblem, AnswerValue, Answers, FieldId, FormDefinition } from '@forms/shared';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { saveResponseAction } from '../../app/(respond)/actions';
import { KEYCAPS, QuestionInput, keyboardHint } from './question-input';

interface Props {
  readonly definition: FormDefinition;
  readonly versionId: string | null;
  readonly mode: 'live' | 'preview';
}

type Phase = 'intro' | 'question' | 'done' | 'closed';

interface Stored {
  readonly responseId: string;
  readonly answers: Answers;
  readonly history: FieldId[];
  readonly phase: Phase;
}

function storageKey(versionId: string): string {
  return `form-builder:response:${versionId}`;
}

function readStored(versionId: string | null): Stored | null {
  if (versionId === null) return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(versionId));
    return raw === null ? null : (JSON.parse(raw) as Stored);
  } catch {
    return null;
  }
}

function writeStored(versionId: string | null, value: Stored): void {
  if (versionId === null) return;
  try {
    window.sessionStorage.setItem(storageKey(versionId), JSON.stringify(value));
  } catch {
    // Private mode or a full quota: the form still works, it just will not
    // survive a reload.
  }
}

export function FormRunner({ definition, versionId, mode }: Props) {
  const startsWithIntro = definition.description !== undefined && definition.description !== '';
  const [phase, setPhase] = useState<Phase>(startsWithIntro ? 'intro' : 'question');
  const [history, setHistory] = useState<FieldId[]>(() => {
    const first = firstField(definition);
    return startsWithIntro || first === null ? [] : [first];
  });
  const [answers, setAnswers] = useState<Answers>({});
  const [numberText, setNumberText] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [submitting, startSubmit] = useTransition();
  const responseId = useRef<string | null>(null);
  const inputRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const restored = useRef(false);
  // Set once the key handlers exist; see the same marker in the builder.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const trapRef = useRef<HTMLInputElement | null>(null);
  /** Whatever a bot typed into the honeypot, sent with every save so the API can drop it. */
  const trap = (): { website?: string } =>
    trapRef.current?.value ? { website: trapRef.current.value } : {};

  const fields = useMemo(
    () => new Map(definition.fields.map((field) => [field.id, field] as const)),
    [definition],
  );
  const currentId = history.at(-1);
  const current = currentId === undefined ? undefined : fields.get(currentId);

  // Restore after hydration, never during it: the server rendered the first
  // screen, and the stored state is only known in the browser.
  useEffect(() => {
    if (restored.current || mode !== 'live') return;
    restored.current = true;
    const stored = readStored(versionId);
    if (stored === null || stored.history.some((id) => !fields.has(id))) return;
    responseId.current = stored.responseId;
    setAnswers(stored.answers);
    setHistory(stored.history);
    setPhase(stored.phase);
  }, [fields, mode, versionId]);

  // In preview, the definition changes under the runner as the author types; a
  // question that was deleted falls out of the history.
  useEffect(() => {
    if (mode !== 'preview') return;
    setHistory((previous) => {
      const kept = previous.filter((id) => fields.has(id));
      if (kept.length > 0 || phase !== 'question') return kept;
      const first = firstField(definition);
      return first === null ? [] : [first];
    });
  }, [definition, fields, mode, phase]);

  useEffect(() => {
    if (mode !== 'live' || responseId.current === null) return;
    writeStored(versionId, { responseId: responseId.current, answers, history, phase });
  }, [answers, history, mode, phase, versionId]);

  // Focus follows the question, so a keyboard or screen-reader user is always
  // on what is being asked. The heading for statements, the input otherwise.
  useEffect(() => {
    if (phase !== 'question') {
      headingRef.current?.focus();
      return;
    }
    const target =
      current?.type === 'statement' ? headingRef.current : (inputRef.current ?? headingRef.current);
    target?.focus({ preventScroll: true });
  }, [current, phase]);

  const ensureId = (): string => {
    responseId.current ??= crypto.randomUUID();
    return responseId.current;
  };

  // Partial saves: latest wins, never more than one in flight.
  const inFlight = useRef(false);
  const queued = useRef<{ history: FieldId[]; answers: Answers } | null>(null);
  const savePartial = useCallback(
    (nextHistory: FieldId[], nextAnswers: Answers) => {
      if (mode !== 'live' || versionId === null) return;
      queued.current = { history: nextHistory, answers: nextAnswers };
      if (inFlight.current) return;
      const pump = async () => {
        while (queued.current !== null) {
          const job = queued.current;
          queued.current = null;
          inFlight.current = true;
          const outcome = await saveResponseAction(ensureId(), {
            formVersionId: versionId,
            answers: submission(job.history, job.answers),
            currentFieldId: job.history.at(-1) ?? null,
            complete: false,
            ...trap(),
          });
          inFlight.current = false;
          if (!outcome.ok && outcome.code === 'GONE') setPhase('closed');
        }
      };
      void pump();
    },
    [mode, versionId],
  );

  const setValue = (value: AnswerValue | undefined, text?: string) => {
    if (current === undefined) return;
    setError(null);
    if (text !== undefined) setNumberText((previous) => ({ ...previous, [current.id]: text }));
    setAnswers((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[current.id];
      else next[current.id] = value;
      return next;
    });
  };

  const goBack = () => {
    if (history.length <= 1) return;
    setError(null);
    setDirection('back');
    setHistory((previous) => previous.slice(0, -1));
  };

  const finish = (finalHistory: FieldId[]) => {
    if (mode === 'preview' || versionId === null) {
      setPhase('done');
      return;
    }
    startSubmit(async () => {
      const outcome = await saveResponseAction(ensureId(), {
        formVersionId: versionId,
        answers: submission(finalHistory, answers),
        currentFieldId: null,
        complete: true,
        ...trap(),
      });
      if (outcome.ok) {
        setPhase('done');
        return;
      }
      if (outcome.code === 'GONE') {
        setPhase('closed');
        return;
      }
      // The server refused something: go back to the first question it named,
      // with its sentence. Only possible if the client logic and the server's
      // disagree, or a value was tampered with.
      const problem: AnswerProblem | undefined = outcome.problems.find(
        (p) => p.fieldId !== null && finalHistory.includes(p.fieldId),
      );
      if (problem?.fieldId) {
        setHistory(finalHistory.slice(0, finalHistory.indexOf(problem.fieldId) + 1));
        setError(problem.message);
      } else {
        setNotice(outcome.message);
      }
    });
  };

  const goNext = () => {
    if (phase === 'intro') {
      const first = firstField(definition);
      setDirection('forward');
      setPhase(first === null ? 'done' : 'question');
      setHistory(first === null ? [] : [first]);
      return;
    }
    if (current === undefined) return;
    const value = answers[current.id];
    if (
      current.type === 'number' &&
      (numberText[current.id] ?? '').trim() !== '' &&
      value === undefined
    ) {
      setError('Enter a number, like 12 or 3.5.');
      return;
    }
    if (isAnswered(value)) {
      const problem = answerProblem(current, value);
      if (problem !== null) {
        setError(problem);
        return;
      }
    } else if (current.required) {
      setError(requiredMessage(current));
      return;
    }
    setError(null);
    const next = nextField(definition, history, answers);
    if (next === null) {
      finish(history);
      return;
    }
    const nextHistory = [...history, next];
    setDirection('forward');
    setHistory(nextHistory);
    savePartial(nextHistory, answers);
  };

  // Keyboard: Enter continues (Shift+Enter is a newline in long text), letters
  // pick choices when the focus is not in a text box.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented || submitting) return;
    const target = event.target as HTMLElement;
    const typing =
      target.tagName === 'TEXTAREA' ||
      (target.tagName === 'INPUT' &&
        !['radio', 'checkbox'].includes((target as HTMLInputElement).type));
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      if (target.tagName === 'BUTTON' || target.tagName === 'A') return;
      event.preventDefault();
      goNext();
      return;
    }
    if (
      typing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      current === undefined ||
      event.key.length !== 1
    )
      return;
    const key = event.key.toUpperCase();
    if (current.type === 'yes_no' && (key === 'Y' || key === 'N')) {
      event.preventDefault();
      setValue(key === 'Y');
    } else if (current.type === 'single_choice' || current.type === 'multi_choice') {
      const option = current.options[KEYCAPS.indexOf(key)];
      if (option === undefined) return;
      event.preventDefault();
      if (current.type === 'single_choice') setValue(option.id);
      else {
        const selected = new Set(
          Array.isArray(answers[current.id]) ? (answers[current.id] as string[]) : [],
        );
        if (selected.has(option.id)) selected.delete(option.id);
        else selected.add(option.id);
        const ordered = current.options.map((o) => o.id).filter((id) => selected.has(id));
        setValue(ordered.length === 0 ? undefined : ordered);
      }
    }
  };

  const restart = () => {
    responseId.current = null;
    setAnswers({});
    setNumberText({});
    setError(null);
    setNotice(null);
    const first = firstField(definition);
    setPhase(startsWithIntro ? 'intro' : 'question');
    setHistory(startsWithIntro || first === null ? [] : [first]);
  };

  const { position, total } = progress(definition, history, answers);
  // Clamped both ways: on the intro screen position is 0, and a negative width
  // is invalid CSS, which the browser renders as a FULL bar.
  const share =
    phase === 'done' ? 1 : total === 0 ? 0 : Math.min(1, Math.max(0, (position - 1) / total));
  const hintId = current === undefined ? 'respond-hint' : `hint-${current.id}`;
  const errorId = current === undefined ? 'respond-error' : `error-${current.id}`;
  const describedBy = [
    current?.description ? `description-${current.id}` : null,
    error ? errorId : null,
    hintId,
  ]
    .filter(Boolean)
    .join(' ');

  // Live, the runner IS the page's main landmark. In the builder's preview it
  // sits inside the builder's own <main>, and two main landmarks is an axe
  // violation and a confusing page for a screen reader.
  const Root = mode === 'live' ? 'main' : 'div';
  return (
    <Root
      {...(mode === 'live'
        ? { id: 'main' }
        : { role: 'region', 'aria-label': 'Preview of the form' })}
      className="respond-page"
      data-mode={mode}
      data-ready={ready || undefined}
      onKeyDown={onKeyDown}
    >
      <header className="respond-top">
        <p className="respond-form-title">{definition.title}</p>
        {phase === 'question' && total > 0 ? (
          <p className="respond-count">
            <span className="mono">{position}</span> of <span className="mono">{total}</span>
          </p>
        ) : null}
        <div
          className="respond-progress"
          role="progressbar"
          aria-label="Progress through the form"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
        >
          <div
            className="respond-progress-fill"
            style={{ inlineSize: `${String(share * 100)}%` }}
          />
        </div>
      </header>

      {phase === 'intro' ? (
        <section
          className="respond-screen"
          data-direction={direction}
          aria-labelledby="respond-intro-title"
        >
          <h1
            id="respond-intro-title"
            className="respond-question respond-intro-title"
            tabIndex={-1}
            ref={headingRef}
          >
            {definition.title}
          </h1>
          <p className="respond-description">{definition.description}</p>
          <div className="respond-actions">
            <button className="respond-ok" type="button" onClick={goNext}>
              Start
            </button>
            <span className="respond-enter-hint">
              press <kbd>Enter ↵</kbd>
            </span>
          </div>
        </section>
      ) : null}

      {phase === 'question' && current !== undefined ? (
        <section
          key={current.id}
          className="respond-screen"
          data-direction={direction}
          aria-labelledby={`question-${current.id}`}
        >
          <p className="respond-number" aria-hidden="true">
            {position}
            <span className="respond-number-arrow">→</span>
          </p>
          <h1
            id={`question-${current.id}`}
            className="respond-question"
            tabIndex={-1}
            ref={headingRef}
          >
            {current.type === 'statement' ||
            current.type === 'single_choice' ||
            current.type === 'multi_choice' ||
            current.type === 'yes_no' ||
            current.type === 'rating' ||
            current.type === 'nps' ? (
              current.title
            ) : (
              <label htmlFor={`answer-${current.id}`}>{current.title}</label>
            )}
            {current.required ? (
              <span className="respond-required">
                <span aria-hidden="true"> *</span>
                <span className="sr-only"> (required)</span>
              </span>
            ) : null}
          </h1>
          {current.description ? (
            <p id={`description-${current.id}`} className="respond-description">
              {current.description}
            </p>
          ) : null}
          <QuestionInput
            field={current}
            value={answers[current.id]}
            text={
              numberText[current.id] ??
              (typeof answers[current.id] === 'number' ? String(answers[current.id]) : '')
            }
            describedBy={describedBy}
            invalid={error !== null}
            onChange={setValue}
            inputRef={inputRef}
          />
          {error === null ? null : (
            <p id={errorId} className="respond-error" role="alert">
              <span aria-hidden="true">⚠ </span>
              {error}
            </p>
          )}
          {notice === null ? null : (
            <p className="respond-error" role="alert">
              <span aria-hidden="true">⚠ </span>
              {notice}
            </p>
          )}
          <div className="respond-actions">
            <button className="respond-ok" type="button" onClick={goNext} disabled={submitting}>
              {submitting
                ? 'Sending'
                : nextField(definition, history, answers) === null
                  ? 'Submit'
                  : 'OK'}
              <span aria-hidden="true"> ✓</span>
            </button>
            <span id={hintId} className="respond-enter-hint">
              {keyboardHint(current)}
            </span>
          </div>
        </section>
      ) : null}

      {phase === 'done' ? (
        <section className="respond-screen respond-end" aria-labelledby="respond-done">
          <p className="respond-end-glyph" aria-hidden="true">
            ✓
          </p>
          <h1 id="respond-done" className="respond-question" tabIndex={-1} ref={headingRef}>
            {definition.ending.title}
          </h1>
          {definition.ending.message ? (
            <p className="respond-description">{definition.ending.message}</p>
          ) : null}
          {mode === 'preview' ? (
            <button className="respond-ok" type="button" onClick={restart}>
              Restart preview
            </button>
          ) : null}
        </section>
      ) : null}

      {phase === 'closed' ? (
        <section className="respond-screen respond-end" aria-labelledby="respond-closed">
          <p className="respond-end-glyph" aria-hidden="true">
            ■
          </p>
          <h1 id="respond-closed" className="respond-question" tabIndex={-1} ref={headingRef}>
            This form is closed
          </h1>
          <p className="respond-description">
            It stopped accepting responses while you were answering.
          </p>
        </section>
      ) : null}

      {phase === 'question' ? (
        <nav className="respond-nav" aria-label="Question navigation">
          <button
            className="respond-nav-button"
            type="button"
            onClick={goBack}
            disabled={history.length <= 1}
          >
            <span aria-hidden="true">↑</span> Previous
          </button>
          {mode === 'preview' ? (
            <button className="respond-nav-button" type="button" onClick={restart}>
              Restart
            </button>
          ) : null}
        </nav>
      ) : null}

      {/* The honeypot. Off-screen, unlabelled for people, and named the way a
          form-filling bot looks for. A save that fills it is dropped server-side. */}
      {mode === 'live' ? (
        <div className="respond-trap" aria-hidden="true">
          <label>
            Website
            <input
              ref={trapRef}
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              defaultValue=""
            />
          </label>
        </div>
      ) : null}
    </Root>
  );
}
