CREATE TABLE "applicants" (
	"email" text PRIMARY KEY NOT NULL,
	"ghl_contact_id" text,
	"ghl_linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Backfill: one row per applicant email, with the GHL contact from their latest synced application.
INSERT INTO "applicants" ("email", "ghl_contact_id", "ghl_linked_at")
SELECT DISTINCT ON ("applicant_email") "applicant_email", "ghl_contact_id",
	CASE WHEN "ghl_contact_id" IS NOT NULL THEN now() END
FROM "applications"
ORDER BY "applicant_email", ("ghl_contact_id" IS NULL), "created_at" DESC
ON CONFLICT ("email") DO NOTHING;
