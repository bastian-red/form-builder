'use client';

import { useTransition } from 'react';

import { setAcceptingAction } from '../../app/(build)/actions';

/**
 * Open or closed, said in a word beside a glyph, with the one button that
 * changes it. Closing asks first: respondents mid-way through are told the form
 * closed on their next save, which is not something to do by a mis-click.
 */
export function AcceptingToggle({
  formId,
  accepting,
}: {
  readonly formId: string;
  readonly accepting: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="accepting" data-state={accepting ? 'open' : 'closed'}>
      <p className="accepting-state">
        <span aria-hidden="true">{accepting ? '● ' : '■ '}</span>
        {accepting ? 'Accepting responses' : 'Closed to responses'}
      </p>
      <button
        className={`button${accepting ? ' button-danger' : ''}`}
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            accepting &&
            !window.confirm('Close this form? People answering it now will not be able to submit.')
          )
            return;
          start(() => setAcceptingAction(formId, !accepting));
        }}
      >
        {pending ? 'Updating' : accepting ? 'Close form' : 'Reopen form'}
      </button>
    </div>
  );
}
