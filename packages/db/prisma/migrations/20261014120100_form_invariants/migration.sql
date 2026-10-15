-- Everything the Prisma datamodel cannot express: CHECK constraints, NOT NULL on
-- a list column, and the two immutability triggers. (The composite foreign key
-- and the GIN index ARE expressible and live in schema.prisma, so the datamodel
-- diff in scripts/db-drift.mjs covers them.) Each name here is exported from
-- src/constraints.ts and checked by db-drift by name, because `prisma migrate
-- diff` is blind to all of it.

-- forms ------------------------------------------------------------------------

ALTER TABLE "forms"
  ADD CONSTRAINT "forms_draft_revision_non_negative" CHECK ("draft_revision" >= 0),
  ADD CONSTRAINT "forms_draft_is_object" CHECK (jsonb_typeof("draft") = 'object'),
  -- The same shape as slugSchema in @forms/shared: a slug the API would refuse
  -- to route must not be storable either.
  ADD CONSTRAINT "forms_slug_shape" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{3,39}$');

-- form_versions ------------------------------------------------------------------

ALTER TABLE "form_versions"
  ADD CONSTRAINT "form_versions_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "form_versions_definition_is_object" CHECK (jsonb_typeof("definition") = 'object');

-- A published version is a snapshot. Responses are read against it forever, so
-- an UPDATE that changed a question would silently change what every stored
-- answer meant. Nothing in the application updates this table; the trigger is
-- what makes that a guarantee instead of a habit.
CREATE FUNCTION "form_versions_refuse_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'form_versions rows are immutable (version % of form %)', OLD."version", OLD."form_id"
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "form_versions_immutable"
  BEFORE UPDATE ON "form_versions"
  FOR EACH ROW EXECUTE FUNCTION "form_versions_refuse_update"();

-- responses ----------------------------------------------------------------------

UPDATE "responses" SET "reached" = ARRAY[]::TEXT[] WHERE "reached" IS NULL;
ALTER TABLE "responses" ALTER COLUMN "reached" SET NOT NULL;

ALTER TABLE "responses"
  ADD CONSTRAINT "responses_answers_is_object" CHECK (jsonb_typeof("answers") = 'object'),
  ADD CONSTRAINT "responses_submitted_after_started" CHECK ("submitted_at" IS NULL OR "submitted_at" >= "started_at"),
  ADD CONSTRAINT "responses_updated_after_started" CHECK ("updated_at" >= "started_at");

-- A submitted response is final. The upsert in apps/api only ever writes rows
-- WHERE submitted_at IS NULL; this makes a code path that forgot the WHERE an
-- error instead of an edit to somebody's answers.
CREATE FUNCTION "responses_refuse_update_after_submit"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."submitted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'response % was submitted and is immutable', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "responses_immutable_after_submit"
  BEFORE UPDATE ON "responses"
  FOR EACH ROW EXECUTE FUNCTION "responses_refuse_update_after_submit"();
