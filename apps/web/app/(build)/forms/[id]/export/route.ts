/**
 * `GET /forms/:id/export?version=N`: the CSV, streamed from the API to the
 * browser without being buffered here. The browser never talks to the API, so
 * this route is the one place a response body is passed through rather than
 * parsed; it mints the token for the signed-in author and forwards the bytes and
 * the download headers as they are.
 */
import { idSchema } from '@forms/shared';
import type { NextRequest } from 'next/server';

import { auth } from '../../../../../auth';
import { apiStream, query } from '../../../../../lib/api';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Sign in to download responses.', { status: 401 });
  if (!idSchema.safeParse(id).success) return new Response('No such form.', { status: 404 });

  const version = request.nextUrl.searchParams.get('version');
  const upstream = await apiStream(
    session.user,
    `/forms/${id}/export.csv${query({ version: version && /^\d{1,6}$/u.test(version) ? version : undefined })}`,
  );
  if (!upstream.ok || upstream.body === null) {
    return new Response(
      upstream.status === 404 ? 'No such form or version.' : 'The export could not be produced.',
      {
        status: upstream.status === 404 ? 404 : 502,
      },
    );
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      'content-disposition':
        upstream.headers.get('content-disposition') ?? 'attachment; filename="responses.csv"',
      'cache-control': 'no-store',
    },
  });
}
