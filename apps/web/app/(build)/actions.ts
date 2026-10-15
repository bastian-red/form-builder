'use server';

/**
 * The author's writes. Each one re-reads the session (a server action is a
 * public POST endpoint; nothing about the page that rendered it is trusted),
 * calls the API with a fresh service token, and returns a small result the
 * client renders. None of them throws for an expected failure: a thrown error in
 * a server action reaches the browser as a generic digest, and "someone saved
 * this form from another tab" deserves a sentence.
 */
import {
  analyzerIssueSchema,
  createFormSchema,
  formDefinitionSchema,
  publishResultSchema,
  saveDraftResultSchema,
  type AnalyzerIssue,
  type FormDefinition,
  type PublishResult,
} from '@forms/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { auth, signOut } from '../../auth';
import { ApiError, apiFetch } from '../../lib/api';

async function currentUser() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  return session.user;
}

const created = z.object({ id: z.string(), slug: z.string() });

export interface CreateFormState {
  readonly error: string | null;
}

export async function createFormAction(
  _previous: CreateFormState,
  form: FormData,
): Promise<CreateFormState> {
  const user = await currentUser();
  const parsed = createFormSchema.safeParse({ title: form.get('title') });
  if (!parsed.success) return { error: 'Give the form a title of up to 120 characters.' };
  let id: string;
  try {
    id = (await apiFetch(user, '/forms', created, { method: 'POST', body: parsed.data })).id;
  } catch (error) {
    console.error('[web] create form failed', error);
    return { error: 'The form could not be created. Try again in a moment.' };
  }
  redirect(`/forms/${id}/edit`);
}

export type SaveDraftResult =
  | { readonly ok: true; readonly revision: number }
  | {
      readonly ok: false;
      readonly reason: 'conflict' | 'invalid' | 'failed';
      readonly message: string;
    };

export async function saveDraftAction(
  id: string,
  definition: FormDefinition,
  revision: number,
): Promise<SaveDraftResult> {
  const user = await currentUser();
  // Parsed here too, so a draft the API would refuse is reported as "invalid"
  // with no round trip, and nothing unparsed is forwarded.
  const parsed = formDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Something in this form is empty or too long to save.',
    };
  }
  try {
    const saved = await apiFetch(user, `/forms/${id}/draft`, saveDraftResultSchema, {
      method: 'PUT',
      body: { definition: parsed.data, revision },
    });
    return { ok: true, revision: saved.revision };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CONFLICT') {
      return { ok: false, reason: 'conflict', message: error.message };
    }
    console.error('[web] draft save failed', error);
    return {
      ok: false,
      reason: 'failed',
      message: 'Not saved. Check your connection; the builder will retry.',
    };
  }
}

export type PublishActionResult =
  | { readonly ok: true; readonly result: PublishResult }
  | { readonly ok: false; readonly message: string; readonly issues: AnalyzerIssue[] };

export async function publishAction(id: string): Promise<PublishActionResult> {
  const user = await currentUser();
  try {
    const result = await apiFetch(user, `/forms/${id}/publish`, publishResultSchema, {
      method: 'POST',
    });
    revalidatePath('/');
    return { ok: true, result };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'UNPROCESSABLE') {
      const issues = z.array(analyzerIssueSchema).safeParse(error.details);
      return { ok: false, message: error.message, issues: issues.success ? issues.data : [] };
    }
    console.error('[web] publish failed', error);
    return {
      ok: false,
      message: 'The form could not be published. Try again in a moment.',
      issues: [],
    };
  }
}

export async function setAcceptingAction(id: string, accepting: boolean): Promise<void> {
  const user = await currentUser();
  await apiFetch(user, `/forms/${id}`, z.unknown(), { method: 'PATCH', body: { accepting } });
  revalidatePath('/');
  revalidatePath(`/forms/${id}/results`);
}

export async function deleteFormAction(form: FormData): Promise<void> {
  const user = await currentUser();
  const id = String(form.get('id') ?? '');
  await apiFetch(user, `/forms/${id}`, z.unknown(), { method: 'DELETE' });
  revalidatePath('/');
  redirect('/');
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/sign-in' });
}
