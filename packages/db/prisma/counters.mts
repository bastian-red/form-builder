/**
 * Prisma adapters for `@forms/analytics`'s recount, shared by the seed and the
 * repair command. One transaction per version: the exclusive advisory lock that
 * `recount` takes is transaction-scoped, so every save of that version waits for
 * the rebuilt counters to commit.
 */
import { recount, type RawExecute, type RawQuery, type StatsRows } from '@forms/analytics';
import type { FormDefinition } from '@forms/shared';

import type pkg from '../generated/client/index.js';

type Client = InstanceType<typeof pkg.PrismaClient>;

export function recountVersion(prisma: Client, versionId: string, definition: FormDefinition): Promise<StatsRows> {
  return prisma.$transaction(
    async (tx) => {
      const raw = ((sql: string, ...params: unknown[]) => tx.$queryRawUnsafe(sql, ...params)) as RawQuery;
      const execute: RawExecute = (sql, ...params) => tx.$executeRawUnsafe(sql, ...params);
      return recount(raw, execute, versionId, definition);
    },
    // A recount of a large version is a full scan; give it room.
    { timeout: 120_000, maxWait: 30_000 },
  );
}
