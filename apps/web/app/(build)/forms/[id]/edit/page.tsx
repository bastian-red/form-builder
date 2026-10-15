import { formDetailSchema, idSchema } from '@forms/shared';
import { notFound } from 'next/navigation';

import { AppBar } from '../../../../../components/app-bar';
import { Builder } from '../../../../../components/builder/builder';
import { ApiError, apiFetch } from '../../../../../lib/api';
import { appBaseUrl } from '../../../../../lib/config';
import { requireUser } from '../../../../../lib/session';

export const metadata = { title: 'Builder' };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/forms/${id}/edit`);
  if (!idSchema.safeParse(id).success) notFound();

  let detail;
  try {
    detail = await apiFetch(user, `/forms/${id}`, formDetailSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <>
      <AppBar
        user={user}
        trail={[{ label: detail.draft.title, href: `/forms/${id}/edit` }, { label: 'Build' }]}
      />
      <main id="main" className="builder-page">
        <h1 className="sr-only">Build “{detail.draft.title}”</h1>
        <Builder
          formId={detail.id}
          slug={detail.slug}
          initial={detail.draft}
          revision={detail.revision}
          versions={detail.versions}
          unpublishedChanges={detail.unpublishedChanges}
          publicUrl={`${appBaseUrl}/f/${detail.slug}`}
        />
      </main>
    </>
  );
}
