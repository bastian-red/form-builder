/**
 * The browser-safe entry point of @forms/shared.
 *
 * Everything re-exported here must be importable from a client component: the
 * builder and the respondent renderer both import the form definition schema.
 * The things that must not -- `jsonwebtoken`, scrypt, `AUTH_SECRET` -- live
 * behind the `@forms/shared/server` subpath, which is the boundary that keeps
 * them out of the client bundle.
 */

export * from './contracts';
export * from './errors';
export * from './form';
