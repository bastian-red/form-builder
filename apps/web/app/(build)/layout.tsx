import type { ReactNode } from 'react';

/** The author's side: the drafting sheet. Tokens are globals.css's `:root`. */
export default function BuildLayout({ children }: { children: ReactNode }) {
  return <div data-surface="build">{children}</div>;
}
