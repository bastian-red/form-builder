#!/usr/bin/env bash
#
# Prove the seed is deterministic, idempotent, and leaves a consistent workspace.
#
# Three properties, each the reason a seed-dependent check would otherwise lie:
#
#   deterministic   two runs produce the same content digest. The E2E suite and
#                   scripts/dev-smoke.sh assert on seeded titles and counts; a
#                   seed that read the clock or Math.random would make them
#                   flaky in a way that looks like an application bug.
#   idempotent      the second run replaces the first instead of adding to it.
#                   Same digest AND same row counts.
#   consistent      the results counters equal the rows they count, every
#                   response sits on its own form's version, and every completed
#                   response has a non-empty server-computed path. A seed that
#                   wrote counters by hand would demonstrate numbers the
#                   application could never produce.
#
# The digest covers content only: form titles, each version's definition, each
# response's id, answers, reached path and submission time. Timestamps the
# database fills in itself are excluded by construction (the seed pins them).
#
#   ./scripts/seed-check.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

# Caller env > .env > .env.example (scripts/load-env.sh says why).
# shellcheck source=scripts/load-env.sh
. scripts/load-env.sh

export DATABASE_URL="${DATABASE_URL:-postgresql://forms:forms@localhost:5441/forms?schema=public}"

# Prisma's URL carries `?schema=public`, which libpq rejects outright.
PSQL_URL="${DATABASE_URL%%\?*}"

# Read out of the seed rather than retyped: a copy that drifts produces a digest
# confidently computed over zero rows, which passes.
DEMO_EMAIL="$(sed -n "s/^const DEMO_EMAIL = '\([^']*\)';.*/\1/p" packages/db/prisma/seed.mts)"
V1_RESPONSES="$(sed -n "s/^const V1_RESPONSES = \([0-9]*\);.*/\1/p" packages/db/prisma/seed.mts)"
V2_RESPONSES="$(sed -n "s/^const V2_RESPONSES = \([0-9]*\);.*/\1/p" packages/db/prisma/seed.mts)"
for pair in "DEMO_EMAIL:$DEMO_EMAIL" "V1_RESPONSES:$V1_RESPONSES" "V2_RESPONSES:$V2_RESPONSES"; do
  [[ -n "${pair#*:}" ]] || { echo "could not read ${pair%%:*} out of packages/db/prisma/seed.mts." >&2; exit 1; }
done

# `string_agg` needs the ORDER BY: without it the row order is whatever the
# planner produced, and the digest changes between two identical workspaces.
# Scoped to the demo account's forms, so rows another lane left behind cannot
# move it.
read -r -d '' DIGEST_SQL <<'SQL_END' || true
WITH demo_forms AS (
  SELECT f.* FROM forms f JOIN users u ON u.id = f.owner_id WHERE u.email = :'demo_email'
), x AS (
  SELECT 'form ' || f.slug || ' ' || f.title || ' ' || md5(f.draft::text) AS x FROM demo_forms f
  UNION ALL
  SELECT 'version ' || v.form_id || ' ' || v.version || ' ' || md5(v.definition::text)
    FROM form_versions v JOIN demo_forms f ON f.id = v.form_id
  UNION ALL
  SELECT 'response ' || r.id || ' ' || md5(r.answers::text) || ' ' || array_to_string(r.reached, ',') || ' ' || coalesce(r.submitted_at::text, '-')
    FROM responses r JOIN demo_forms f ON f.id = r.form_id
)
SELECT count(*) || ' ' || coalesce(md5(string_agg(x, '|' ORDER BY x)), '-') FROM x;
SQL_END

# Each a count that must be zero, named for what it would mean.
read -r -d '' INVARIANT_SQL <<'SQL_END' || true
SELECT
  -- version_stats.started differs from the rows of that version
  (SELECT count(*) FROM form_versions v LEFT JOIN version_stats s ON s.form_version_id = v.id
    WHERE coalesce(s.started, 0) <> (SELECT count(*) FROM responses r WHERE r.form_version_id = v.id)) || ' ' ||
  -- version_stats.completed differs from the submitted rows
  (SELECT count(*) FROM form_versions v LEFT JOIN version_stats s ON s.form_version_id = v.id
    WHERE coalesce(s.completed, 0) <> (SELECT count(*) FROM responses r WHERE r.form_version_id = v.id AND r.submitted_at IS NOT NULL)) || ' ' ||
  -- a completed response whose server-computed path is empty
  (SELECT count(*) FROM responses WHERE submitted_at IS NOT NULL AND cardinality(reached) = 0) || ' ' ||
  -- the demo form's response counts, per version, as the seed declares them
  (SELECT string_agg(v.version || ':' || (SELECT count(*) FROM responses r WHERE r.form_version_id = v.id), ',' ORDER BY v.version)
     FROM form_versions v JOIN forms f ON f.id = v.form_id WHERE f.slug = 'product-feedback');
SQL_END

digest() {
  printf '%s\n' "$DIGEST_SQL" | psql "$PSQL_URL" --no-psqlrc --quiet --tuples-only --no-align -v demo_email="$DEMO_EMAIL"
}

run_seed() {
  pnpm --filter @forms/db exec tsx prisma/seed.mts >/dev/null
}

echo "seed-check: first run"
run_seed
FIRST="$(digest)"
echo "  $FIRST"

echo "seed-check: second run"
run_seed
SECOND="$(digest)"
echo "  $SECOND"

if [[ "$FIRST" != "$SECOND" ]]; then
  echo >&2
  echo "FAIL: the seed is not deterministic or not idempotent." >&2
  echo "  run 1: $FIRST" >&2
  echo "  run 2: $SECOND" >&2
  echo "A changed row count means the teardown left rows behind. The same count" >&2
  echo "with a changed digest means the generator read the clock or Math.random." >&2
  exit 1
fi

if [[ "${FIRST%% *}" == "0" ]]; then
  echo "FAIL: the seed produced nothing. A digest over zero rows is stable and proves nothing." >&2
  exit 1
fi

read -r STARTED_DRIFT COMPLETED_DRIFT EMPTY_PATHS PER_VERSION <<<"$(printf '%s\n' "$INVARIANT_SQL" |
  psql "$PSQL_URL" --no-psqlrc --quiet --tuples-only --no-align)"

failed=0
if [[ "$STARTED_DRIFT" != "0" || "$COMPLETED_DRIFT" != "0" ]]; then
  echo "FAIL: ${STARTED_DRIFT} version(s) with a wrong started counter, ${COMPLETED_DRIFT} with a wrong completed counter." >&2
  echo "The seed must rebuild the counters with recount after inserting responses." >&2
  failed=1
fi
if [[ "$EMPTY_PATHS" != "0" ]]; then
  echo "FAIL: ${EMPTY_PATHS} completed response(s) with an empty reached path." >&2
  failed=1
fi
if [[ "$PER_VERSION" != "1:${V1_RESPONSES},2:${V2_RESPONSES}" ]]; then
  echo "FAIL: the demo form's responses per version are ${PER_VERSION}, expected 1:${V1_RESPONSES},2:${V2_RESPONSES}." >&2
  failed=1
fi
[[ $failed -eq 0 ]] || exit 1

echo "PASS: two runs, identical digest over ${FIRST%% *} rows; counters equal the rows; responses ${PER_VERSION}."
