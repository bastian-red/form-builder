import { publicFormSchema, slugSchema } from '@forms/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FormRunner } from '../../../../components/respond/form-runner';
import { ApiError, apiFetch } from '../../../../lib/api';

type Params = Promise<{ slug: string }>;

async function load(slug: string) {
  if (!slugSchema.safeParse(slug).success) notFound();
  try {
    return {
      form: await apiFetch(null, `/public/forms/${slug}`, publicFormSchema),
      closed: false,
    } as const;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    if (error instanceof ApiError && error.status === 410)
      return { form: null, closed: true } as const;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { form } = await load((await params).slug);
  // Never indexed: a form link is shared with the people meant to answer it.
  return {
    title: form?.definition.title ?? 'Form closed',
    robots: { index: false, follow: false },
  };
}

/**
 * The public form. Server-rendered, so the title and the first screen are in
 * the first byte of HTML; the runner takes over on hydration.
 */
export default async function PublicFormPage({ params }: { params: Params }) {
  const { form, closed } = await load((await params).slug);
  if (closed || form === null) {
    return (
      <main id="main" className="respond-page">
        <section className="respond-screen respond-end" aria-labelledby="closed-title">
          <p className="respond-end-glyph" aria-hidden="true">
            ■
          </p>
          <h1 id="closed-title" className="respond-question">
            This form is closed
          </h1>
          <p className="respond-description">
            It is no longer accepting responses. Thank you for stopping by.
          </p>
        </section>
      </main>
    );
  }
  return <FormRunner definition={form.definition} versionId={form.versionId} mode="live" />;
}
