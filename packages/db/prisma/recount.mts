/**
 * `pnpm db:recount [versionId...]`: rebuild the results counters from the
 * responses, for the given versions or for every version.
 *
 * The repair tool for the one way the counters could ever disagree with the
 * rows: a write that bypassed the API (a hand-run INSERT, a restore from a
 * dump of `responses` alone). Safe to run against a live database; each version
 * is rebuilt under an exclusive advisory lock that saves of that version wait on.
 * Prints the before and after totals, so the drift it repaired is visible.
 */
import { formDefinitionSchema } from '@forms/shared';

import pkg from '../generated/client/index.js';
import { recountVersion } from './counters.mjs';

const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const only = process.argv.slice(2);
  const versions = await prisma.formVersion.findMany({
    where: only.length > 0 ? { id: { in: only } } : {},
    select: { id: true, version: true, definition: true, form: { select: { title: true } }, stats: true },
  });
  let drifted = 0;
  for (const version of versions) {
    const before = version.stats;
    const after = await recountVersion(prisma, version.id, formDefinitionSchema.parse(version.definition));
    const changed = (before?.started ?? 0) !== after.started || (before?.completed ?? 0) !== after.completed;
    if (changed) drifted += 1;
    console.log(
      `${changed ? 'repaired' : 'ok      '} ${version.id} "${version.form.title}" v${String(version.version)}: ` +
        `started ${String(before?.started ?? 0)} -> ${String(after.started)}, completed ${String(before?.completed ?? 0)} -> ${String(after.completed)}`,
    );
  }
  console.log(`recount: ${String(versions.length)} version(s), ${String(drifted)} with different totals.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
