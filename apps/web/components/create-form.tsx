'use client';

import { useActionState } from 'react';

import { createFormAction, type CreateFormState } from '../app/(build)/actions';

/** Name a form and go straight into the builder. A plain POST before hydration. */
export function CreateForm() {
  const [state, action, pending] = useActionState<CreateFormState, FormData>(createFormAction, {
    error: null,
  });
  return (
    <form className="create-form" action={action}>
      <label className="field">
        <span className="field-label">New form</span>
        <input
          className="field-input"
          name="title"
          required
          maxLength={120}
          placeholder="Customer onboarding survey"
        />
      </label>
      <button className="button button-primary" type="submit" disabled={pending}>
        {pending ? 'Creating' : 'Create and open'}
      </button>
      {state.error === null ? null : (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
