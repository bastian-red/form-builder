import type { SessionUser } from '@forms/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { signOutAction } from '../app/(build)/actions';
import { Brand } from './brand';

/**
 * The author's top bar: where you are (a breadcrumb that ends at the current
 * form and view), who you are, and the way out. One row, ruled underneath like
 * every other line on the drafting sheet.
 */
export function AppBar({
  user,
  trail = [],
  children,
}: {
  readonly user: SessionUser;
  readonly trail?: ReadonlyArray<{ label: string; href?: string }>;
  readonly children?: ReactNode;
}) {
  return (
    <header className="app-bar">
      <nav className="app-trail" aria-label="Breadcrumb">
        <Brand />
        <ol>
          <li>
            <Link href="/">Forms</Link>
          </li>
          {trail.map((step) => (
            <li key={step.label}>
              {step.href === undefined ? (
                <span aria-current="page">{step.label}</span>
              ) : (
                <Link href={step.href}>{step.label}</Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="app-bar-end">
        {children}
        <span className="app-user">{user.name}</span>
        <form action={signOutAction}>
          <button className="button button-quiet" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
