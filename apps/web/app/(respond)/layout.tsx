import type { ReactNode } from 'react';

/** The respondent's page: apricot paper and ochre, re-tokened in respond.css. */
export default function RespondLayout({ children }: { children: ReactNode }) {
  return <div data-surface="respond">{children}</div>;
}
