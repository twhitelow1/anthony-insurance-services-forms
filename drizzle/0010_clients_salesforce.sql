CREATE TABLE "client_emails" (
	"email" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"message" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"primary_email" text NOT NULL,
	"phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"address" jsonb,
	"search_text" text DEFAULT '' NOT NULL,
	"sf_account_id" text,
	"sf_contact_id" text,
	"sf_status" text DEFAULT 'not_synced' NOT NULL,
	"sf_synced_at" timestamp with time zone,
	"sf_last_error" text,
	"ghl_company_id" text,
	"merged_into" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salesforce_backfill_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"mode" text NOT NULL,
	"account_id" text NOT NULL,
	"account_name" text,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text NOT NULL,
	"client_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "sf_opportunity_id" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "sf_sync_status" text DEFAULT 'not_synced' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "sf_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "sf_last_error" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "sf_pdf_hash" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "sf_content_version_id" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "sf_feed_item_id" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "ghl_links_noted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "client_emails" ADD CONSTRAINT "client_emails_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_events" ADD CONSTRAINT "client_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_emails_client_idx" ON "client_emails" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_events_client_idx" ON "client_events" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "clients_updated_idx" ON "clients" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "clients_sf_account_idx" ON "clients" USING btree ("sf_account_id");--> statement-breakpoint
CREATE INDEX "sf_backfill_run_idx" ON "salesforce_backfill_rows" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "sync_jobs_due_idx" ON "sync_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "sync_jobs_target_idx" ON "sync_jobs" USING btree ("kind","target_id");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_client_idx" ON "applications" USING btree ("client_id");--> statement-breakpoint
-- One client per existing applicant or prospect email (applications plus unfinished drafts), from their latest details.
WITH src AS (
	SELECT applicant_email AS email, applicant_name AS person, business_name AS business, "values"->>'phone' AS phone, created_at AS ts
	FROM "applications"
	UNION ALL
	SELECT email, name, business_name, "values"->>'phone', updated_at
	FROM "drafts" WHERE email IS NOT NULL AND email <> ''
), latest AS (
	SELECT DISTINCT ON (email) email, person, business, NULLIF(trim(phone), '') AS phone
	FROM src ORDER BY email, ts DESC
), ins AS (
	INSERT INTO "clients" ("name", "contact_name", "primary_email", "phones", "search_text")
	SELECT
		COALESCE(NULLIF(trim(business), ''), NULLIF(trim(person), ''), email),
		NULLIF(trim(person), ''),
		email,
		CASE WHEN phone IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(phone) END,
		lower(concat_ws(' ', person, business, email, regexp_replace(COALESCE(phone, ''), '\D', '', 'g')))
	FROM latest
	RETURNING "id", "primary_email"
)
INSERT INTO "client_emails" ("email", "client_id") SELECT "primary_email", "id" FROM ins;--> statement-breakpoint
UPDATE "applications" SET "client_id" = ce."client_id" FROM "client_emails" ce WHERE ce."email" = "applications"."applicant_email";--> statement-breakpoint
UPDATE "drafts" SET "client_id" = ce."client_id" FROM "client_emails" ce WHERE ce."email" = "drafts"."email";
