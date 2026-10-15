/**
 * The names Postgres will use when it refuses a write.
 *
 * Catch blocks match on these, never on the message text. Postgres owns the
 * wording and changes it between minor versions; the constraint name is ours and
 * is set explicitly in the migration.
 *
 * Two vocabularies, because two clients report the same violation differently:
 * Prisma's typed client raises `PrismaClientKnownRequestError` with a `code` like
 * `P2002`, while `$queryRaw` surfaces the SQLSTATE (`23505`) instead. A predicate
 * that only reads one of them is right half the time -- and a sibling project
 * shipped exactly that bug, where every conflict became a 500 while its unit
 * tests passed against a fixture no client ever produces.
 */

// --- Prisma's typed client -------------------------------------------------
export const PRISMA_UNIQUE_VIOLATION = 'P2002';
export const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';
export const PRISMA_NOT_FOUND = 'P2025';

// --- SQLSTATE, as seen through $queryRaw -----------------------------------
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

// --- Constraint, index and trigger names, from the migrations ---------------
export const USER_EMAIL_UNIQUE = 'users_email_key';
export const FORM_SLUG_UNIQUE = 'forms_slug_key';
export const VERSION_NUMBER_UNIQUE = 'form_versions_form_id_version_key';
export const VERSION_ID_FORM_UNIQUE = 'form_versions_id_form_id_key';
export const RESPONSES_ANSWERS_GIN = 'responses_answers_gin';

export const DRAFT_REVISION_NON_NEGATIVE = 'forms_draft_revision_non_negative';
export const DRAFT_IS_OBJECT = 'forms_draft_is_object';
export const SLUG_SHAPE = 'forms_slug_shape';
export const VERSION_POSITIVE = 'form_versions_version_positive';
export const DEFINITION_IS_OBJECT = 'form_versions_definition_is_object';
export const ANSWERS_IS_OBJECT = 'responses_answers_is_object';
export const SUBMITTED_AFTER_STARTED = 'responses_submitted_after_started';
export const UPDATED_AFTER_STARTED = 'responses_updated_after_started';
export const RESPONSE_VERSION_BELONGS_TO_FORM = 'responses_version_belongs_to_form';
export const VERSION_STATS_NON_NEGATIVE = 'version_stats_non_negative';
export const FIELD_STATS_NON_NEGATIVE = 'field_stats_non_negative';
export const ANSWER_STATS_NON_NEGATIVE = 'answer_stats_non_negative';
export const DURATION_STATS_NON_NEGATIVE = 'duration_stats_non_negative';

export const VERSIONS_IMMUTABLE = 'form_versions_immutable';
export const RESPONSES_IMMUTABLE_AFTER_SUBMIT = 'responses_immutable_after_submit';

/**
 * The same names, grouped by what kind of object they are.
 *
 * Not a second list: every group is built from the constants above, and
 * `constraints.test.ts` asserts that every exported name appears in exactly one
 * group. `scripts/db-drift.mjs` checks each group against the catalog of a
 * migrated database.
 */
export const CHECK_CONSTRAINTS = Object.freeze({
  DRAFT_REVISION_NON_NEGATIVE,
  DRAFT_IS_OBJECT,
  SLUG_SHAPE,
  VERSION_POSITIVE,
  DEFINITION_IS_OBJECT,
  ANSWERS_IS_OBJECT,
  SUBMITTED_AFTER_STARTED,
  UPDATED_AFTER_STARTED,
  VERSION_STATS_NON_NEGATIVE,
  FIELD_STATS_NON_NEGATIVE,
  ANSWER_STATS_NON_NEGATIVE,
  DURATION_STATS_NON_NEGATIVE,
});

export const FOREIGN_KEYS = Object.freeze({ RESPONSE_VERSION_BELONGS_TO_FORM });

export const UNIQUE_INDEXES = Object.freeze({
  USER_EMAIL_UNIQUE,
  FORM_SLUG_UNIQUE,
  VERSION_NUMBER_UNIQUE,
  VERSION_ID_FORM_UNIQUE,
});

/** Non-unique indexes whose absence is silent: a sequential scan, never an error. */
export const INDEXES = Object.freeze({ RESPONSES_ANSWERS_GIN });

export const TRIGGERS = Object.freeze({ VERSIONS_IMMUTABLE, RESPONSES_IMMUTABLE_AFTER_SUBMIT });

/**
 * The COLUMNS each unique index covers, as Postgres names them.
 *
 * The typed client reports a unique violation's COLUMNS in `meta.target` and
 * never the index name; `$queryRaw` reports the name in the message and nothing
 * in `meta`. `violatedUniqueIndex` in `errors.ts` reads both. Columns are
 * database names (snake_case, after `@map`), because that is what Prisma
 * reports. Do not "correct" them to the Prisma field names.
 */
export const UNIQUE_INDEX_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [USER_EMAIL_UNIQUE]: Object.freeze(['email']),
  [FORM_SLUG_UNIQUE]: Object.freeze(['slug']),
  [VERSION_NUMBER_UNIQUE]: Object.freeze(['form_id', 'version']),
  [VERSION_ID_FORM_UNIQUE]: Object.freeze(['id', 'form_id']),
});
