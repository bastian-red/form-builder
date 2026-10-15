/**
 * The session shape, taught to Auth.js.
 *
 * Auth.js types `session.user` as `{ name?, email?, image? }`, which has none of
 * what this app needs: the id every form query is scoped by. Without this file each use is a type error, and the usual fix
 * is a cast, which is a claim nobody checked. `SessionUser` is the contract from
 * `@forms/shared`, so this cannot drift from what `auth.ts` parses into the token.
 */
import type { SessionUser } from '@forms/shared';

declare module 'next-auth' {
  interface Session {
    user: SessionUser;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    /** Namespaced, so it cannot collide with a claim Auth.js owns. */
    forms?: SessionUser;
  }
}
