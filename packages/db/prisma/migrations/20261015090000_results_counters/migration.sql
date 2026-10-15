-- Results counters (docs/SPECS.md 7). Maintained in the same transaction as the
-- response they count; rebuildable from responses at any time by `recount` in
-- services/analytics. Every count is non-negative: a negative counter is a bug
-- in the delta arithmetic, and the CHECK turns that bug into a failed save
-- instead of a results page that quietly lies.

-- CreateTable
CREATE TABLE "version_stats" (
    "form_version_id" TEXT NOT NULL,
    "started" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "version_stats_pkey" PRIMARY KEY ("form_version_id")
);

-- CreateTable
CREATE TABLE "field_stats" (
    "form_version_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "reached_all" INTEGER NOT NULL DEFAULT 0,
    "reached_completed" INTEGER NOT NULL DEFAULT 0,
    "answered" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "field_stats_pkey" PRIMARY KEY ("form_version_id","field_id")
);

-- CreateTable
CREATE TABLE "answer_stats" (
    "form_version_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "answer_stats_pkey" PRIMARY KEY ("form_version_id","field_id","value")
);

-- CreateTable
CREATE TABLE "duration_stats" (
    "form_version_id" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "duration_stats_pkey" PRIMARY KEY ("form_version_id","seconds")
);

-- AddForeignKey
ALTER TABLE "version_stats" ADD CONSTRAINT "version_stats_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_stats" ADD CONSTRAINT "field_stats_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_stats" ADD CONSTRAINT "answer_stats_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duration_stats" ADD CONSTRAINT "duration_stats_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "version_stats"
  ADD CONSTRAINT "version_stats_non_negative" CHECK ("started" >= 0 AND "completed" >= 0 AND "completed" <= "started");
ALTER TABLE "field_stats"
  ADD CONSTRAINT "field_stats_non_negative" CHECK ("reached_all" >= 0 AND "reached_completed" >= 0 AND "answered" >= 0);
ALTER TABLE "answer_stats"
  ADD CONSTRAINT "answer_stats_non_negative" CHECK ("count" >= 0);
ALTER TABLE "duration_stats"
  ADD CONSTRAINT "duration_stats_non_negative" CHECK ("count" >= 0 AND "seconds" >= 0);
