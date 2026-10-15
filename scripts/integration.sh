#!/usr/bin/env bash
#
# The integration lane: the real API module graph against a real Postgres and a
# real Redis, plus the database drift check and the seed.
#
#   ./scripts/integration.sh              # every file
#   ./scripts/integration.sh respond      # one file, by name
#
# The API is booted IN PROCESS by the suite (test/support.ts), so there is no
# server to start here and no port to wait on: what this lane tests is the
# module graph -- a guard that is default-closed, an upsert that is idempotent,
# a trigger that refuses an edit -- and a child process would put one more layer
# of guessing between a failure and its cause.
set -euo pipefail

cd "$(dirname "$0")/.."

# Caller env > .env > .env.example (scripts/load-env.sh says why).
# shellcheck source=scripts/load-env.sh
. scripts/load-env.sh

export DATABASE_URL="${DATABASE_URL:-postgresql://forms:forms@localhost:5441/forms?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6387}"

if [[ -z "${AUTH_SECRET:-}" ]]; then
  echo "AUTH_SECRET is not set. The suite mints tokens with it." >&2
  exit 1
fi

# The general budget is lifted: this lane makes hundreds of signed-in requests
# as one user inside a minute. The auth and respond budgets are NOT lifted --
# the suite asserts a 429 from each, using its own address per test so one
# test's spend never leaks into another's.
export RATE_LIMIT_GLOBAL="${INTEGRATION_RATE_LIMIT_GLOBAL:-100000}"

# Workspace packages are imported through their dist/, and a CI checkout has
# none. Turbo makes this a cache hit when nothing changed.
pnpm exec turbo run build --filter=@forms/api^... --output-logs=errors-only >/dev/null

echo "integration: preflight"
pnpm --filter @forms/db exec prisma migrate deploy >/dev/null
node scripts/db-drift.mjs
pnpm --filter @forms/db exec tsx prisma/seed.mts >/dev/null
echo "  migrations applied, no drift, seeded"

# The rate-limit counters live in Redis for a minute; a second run inside that
# minute would start with the first run's 429 budgets spent. Only this lane's
# own keys are removed.
redis-cli -u "$REDIS_URL" --scan --pattern 'throttle:*' 2>/dev/null | xargs -r redis-cli -u "$REDIS_URL" del >/dev/null 2>&1 || \
  node -e "
    const { Redis } = require('./apps/api/node_modules/ioredis');
    const r = new Redis(process.env.REDIS_URL);
    r.keys('*throttle*').then((k) => (k.length ? r.del(...k) : 0)).finally(() => r.disconnect());
  "

echo "integration: running the API suite"
if [[ $# -gt 0 ]]; then
  pnpm --filter @forms/api exec vitest run --config vitest.integration.config.ts "$@"
else
  pnpm --filter @forms/api exec vitest run --config vitest.integration.config.ts
fi
