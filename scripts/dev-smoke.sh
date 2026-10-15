#!/usr/bin/env bash
#
# Prove the DOCUMENTED `pnpm dev` serves a working app from a cold start.
#
# Every other lane supplies its own environment (e2e.sh and integration.sh source
# .env and start the apps directly, bypassing turbo), so none of them can see the
# failure that sank three sibling projects for months: turbo in strict env mode
# stripping names the app needs, and `pnpm dev` booting an API with no
# AUTH_SECRET. This script strips every .env name from its own environment with
# `env -u` and runs `pnpm dev` exactly as the README says, so the only way the
# configuration can reach the processes is the path a reader's machine uses:
# scripts/dev.sh sourcing .env, turbo passing declared names through.
#
# Assert on content, never on a status code. A broken app answers 200 with an
# error page. So this signs in through Auth.js and requires, from four different
# API paths: the seeded form in the author's list, the seeded first question on
# the results page (read from the counters), the public form by its slug with no
# session at all, and the API's own /health with both dependencies ok.
#
# Negative check (docs/ROADMAP.md 6): point "dev" in package.json back at
# `turbo run dev` and this fails, because nothing then loads .env.
#
# Usage: ./scripts/dev-smoke.sh      (datastores up, migrated, seeded)
set -euo pipefail
set -m

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOG="${LOG:-/tmp/forms-dev-smoke.log}"
COOKIES="$(mktemp -t forms-dev-smoke-cookies.XXXXXX)"
DEV_PID=""
WAIT_SECONDS="${WAIT_SECONDS:-120}"

cleanup() {
  if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill -- -"$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  rm -f "$COOKIES"
}
trap cleanup EXIT

die() {
  echo >&2
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f .env ]] || die "no .env in the repo root. See README.md, 'Running it'."

env_value() { sed -n "s/^[[:space:]]*$1=//p" .env | tail -1; }
API_PORT="$(env_value API_PORT)"
WEB_PORT="$(env_value WEB_PORT)"
API_BASE_URL="http://localhost:${API_PORT:-4000}"
APP_BASE_URL="http://localhost:${WEB_PORT:-3000}"

# The seeded facts, read out of the seed rather than retyped.
SEED=packages/db/prisma/seed.mts
seed_const() { sed -n "s/^const $1 = '\([^']*\)';.*/\1/p" "$SEED"; }
DEMO_EMAIL="$(seed_const DEMO_EMAIL)"
DEMO_PASSWORD="$(seed_const DEMO_PASSWORD)"
DEMO_FORM_TITLE="$(seed_const DEMO_FORM_TITLE)"
DEMO_FORM_SLUG="$(seed_const DEMO_FORM_SLUG)"
DEMO_FIRST_QUESTION="$(seed_const DEMO_FIRST_QUESTION)"
for pair in "DEMO_EMAIL:$DEMO_EMAIL" "DEMO_PASSWORD:$DEMO_PASSWORD" "DEMO_FORM_TITLE:$DEMO_FORM_TITLE" \
  "DEMO_FORM_SLUG:$DEMO_FORM_SLUG" "DEMO_FIRST_QUESTION:$DEMO_FIRST_QUESTION"; do
  [[ -n "${pair#*:}" ]] || die "could not read ${pair%%:*} out of ${SEED}."
done

for url in "${API_BASE_URL}/health" "${APP_BASE_URL}/sign-in"; do
  if curl -sf -o /dev/null "$url" 2>/dev/null; then
    die "something is already serving ${url}. Stop it first."
  fi
done

# Cold, like a fresh clone: no app build output for `dev` to lean on. The
# workspace packages' dist/ is left alone deliberately -- `dev` dependsOn ^build,
# and whether that rebuild happens is part of what is being tested; CI runs this
# on a checkout that has none at all.
echo "==> Removing app build outputs"
for stale in apps/*/dist apps/*/.next; do
  [[ -e "$stale" ]] || continue
  rm -rf "${ROOT:?}/${stale}"
  echo "    removed ${stale}"
done

mapfile -t ENV_KEYS < <(
  sed -n 's/^[[:space:]]*#\?[[:space:]]*\([A-Z][A-Z0-9_]*\)[[:space:]]*=.*/\1/p' .env.example .env | sort -u
)
[[ ${#ENV_KEYS[@]} -gt 0 ]] || die "parsed no variable names out of .env.example."
UNSET_ARGS=()
for key in "${ENV_KEYS[@]}"; do UNSET_ARGS+=(-u "$key"); done

echo "==> Starting: pnpm dev (${#ENV_KEYS[@]} .env names stripped from the child environment)"
echo "    log: ${LOG}"
env "${UNSET_ARGS[@]}" pnpm dev >"$LOG" 2>&1 &
DEV_PID=$!

wait_for() {
  local url="$1" name="$2"
  local i
  for ((i = 0; i < WAIT_SECONDS; i++)); do
    curl -sf -o /dev/null "$url" 2>/dev/null && return 0
    if ! kill -0 "$DEV_PID" 2>/dev/null; then
      echo "pnpm dev exited before ${name} came up. Last 40 lines of ${LOG}:" >&2
      tail -40 "$LOG" >&2
      exit 1
    fi
    sleep 1
  done
  echo "${name} never came up at ${url} within ${WAIT_SECONDS}s. Last 40 lines of ${LOG}:" >&2
  tail -40 "$LOG" >&2
  exit 1
}
echo "==> Waiting for api and web"
wait_for "${API_BASE_URL}/health" api
wait_for "${APP_BASE_URL}/sign-in" web

json_field() {
  node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      try { process.stdout.write(String(JSON.parse(raw)[process.argv[1]] ?? "")); } catch {}
    });' "$1"
}

echo "==> Checking /health reports every dependency ok"
for pair in "api:${API_BASE_URL}"; do
  body="$(curl -s "${pair#*:}/health")"
  [[ "$(json_field status <<<"$body")" == "ok" ]] ||
    die "${pair%%:*} /health is not ok: ${body}"
done

echo "==> Signing in as ${DEMO_EMAIL} through Auth.js"
csrf="$(curl -s -c "$COOKIES" -b "$COOKIES" "${APP_BASE_URL}/api/auth/csrf" | json_field csrfToken)"
[[ -n "$csrf" ]] || die "GET /api/auth/csrf returned no csrfToken. Auth.js is not mounted."
curl -s -o /dev/null -L -c "$COOKIES" -b "$COOKIES" \
  --data-urlencode "csrfToken=${csrf}" \
  --data-urlencode "email=${DEMO_EMAIL}" \
  --data-urlencode "password=${DEMO_PASSWORD}" \
  "${APP_BASE_URL}/api/auth/callback/credentials"
session="$(curl -s -c "$COOKIES" -b "$COOKIES" "${APP_BASE_URL}/api/auth/session")"
grep -qF "$DEMO_EMAIL" <<<"$session" || {
  tail -40 "$LOG" >&2
  die "sign-in produced no session (${session}). AUTH_SECRET never reached a process, or the seed did not run."
}

echo "==> Checking the form list renders the seeded form"
list="$(curl -s -L -b "$COOKIES" -c "$COOKIES" "${APP_BASE_URL}/")"
grep -qF "$DEMO_FORM_TITLE" <<<"$list" || {
  tail -40 "$LOG" >&2
  die "/ does not contain '${DEMO_FORM_TITLE}'. It is an error page or an empty shell."
}
# The link whose TEXT is the seeded title, not the first link: other lanes create
# forms in the same database, and the newest sorts first.
FORM_ID="$(grep -o "href=\"/forms/[a-z0-9]*/edit\">${DEMO_FORM_TITLE}<" <<<"$list" | head -1 | sed 's|href="/forms/||; s|/edit".*||')"
[[ -n "$FORM_ID" ]] || die "/ rendered no builder link for '${DEMO_FORM_TITLE}'."

echo "==> Checking /forms/${FORM_ID}/results renders the seeded questions and counts"
results="$(curl -s -L -b "$COOKIES" "${APP_BASE_URL}/forms/${FORM_ID}/results")"
grep -qF "$DEMO_FIRST_QUESTION" <<<"$results" || {
  tail -40 "$LOG" >&2
  die "the results page does not carry '${DEMO_FIRST_QUESTION}'."
}
grep -qF "Completion rate" <<<"$results" || die "the results page has no KPI row."

echo "==> Checking the public form /f/${DEMO_FORM_SLUG} with no session"
public="$(curl -s "${APP_BASE_URL}/f/${DEMO_FORM_SLUG}")"
grep -qF "$DEMO_FORM_TITLE" <<<"$public" || {
  tail -40 "$LOG" >&2
  die "/f/${DEMO_FORM_SLUG} does not carry the form title. The public read path is broken."
}

echo
echo "PASS: pnpm dev serves a working app with only .env as configuration."
