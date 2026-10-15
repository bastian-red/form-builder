/**
 * @forms/analytics: results for one form version.
 *
 * SQL over JSONB for the counts (`queries.ts`), pure arithmetic for the
 * statistics (`arithmetic.ts`), the contract shape (`build.ts`), and a
 * fingerprint-keyed cache (`results.ts`). Takes a `RawQuery` port and a cache
 * port; knows nothing about Nest, Prisma or Redis.
 */
export * from './arithmetic';
export * from './build';
export * from './counters';
export * from './queries';
export * from './results';
