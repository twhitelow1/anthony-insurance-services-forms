CREATE TABLE "contact_emails" (
	"email" text PRIMARY KEY NOT NULL,
	"contact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"first_name" text,
	"last_name" text,
	"name" text NOT NULL,
	"title" text,
	"primary_email" text,
	"phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sf_contact_id" text,
	"ghl_contact_id" text,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mapping_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"source_name" text NOT NULL,
	"source_detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposal" text NOT NULL,
	"confidence" text NOT NULL,
	"target_id" text,
	"target_name" text,
	"reason" text,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision" text,
	"decision_target_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "primary_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "is_individual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "name_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "possible_duplicate_of" uuid;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_emails" ADD CONSTRAINT "contact_emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_emails_contact_idx" ON "contact_emails" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contacts_client_idx" ON "contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "contacts_sf_idx" ON "contacts" USING btree ("sf_contact_id");--> statement-breakpoint
CREATE INDEX "contacts_ghl_idx" ON "contacts" USING btree ("ghl_contact_id");--> statement-breakpoint
CREATE INDEX "mapping_rows_run_idx" ON "mapping_rows" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "mapping_rows_kind_idx" ON "mapping_rows" USING btree ("kind","created_at");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_contact_idx" ON "applications" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "clients_name_key_idx" ON "clients" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "clients_ghl_company_idx" ON "clients" USING btree ("ghl_company_id");--> statement-breakpoint
-- One contact per existing client email, from that email's latest application or unfinished application.
WITH src AS (
	SELECT applicant_email AS email, applicant_name AS person, "values"->>'first_name' AS fn, "values"->>'last_name' AS ln, NULLIF(trim("values"->>'phone'), '') AS phone, created_at AS ts
	FROM "applications"
	UNION ALL
	SELECT email, name, "values"->>'first_name', "values"->>'last_name', NULLIF(trim("values"->>'phone'), ''), updated_at
	FROM "drafts" WHERE email IS NOT NULL AND email <> ''
), latest AS (
	SELECT DISTINCT ON (email) email, person, fn, ln, phone FROM src ORDER BY email, ts DESC
)
INSERT INTO "contacts" ("client_id", "first_name", "last_name", "name", "primary_email", "phones", "sf_contact_id", "ghl_contact_id", "search_text")
SELECT
	ce."client_id",
	NULLIF(trim(l.fn), ''),
	NULLIF(trim(l.ln), ''),
	COALESCE(NULLIF(trim(l.person), ''), NULLIF(trim(c."contact_name"), ''), ce."email"),
	ce."email",
	CASE WHEN l.phone IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(l.phone) END,
	CASE WHEN c."primary_email" = ce."email" THEN c."sf_contact_id" END,
	ap."ghl_contact_id",
	lower(concat_ws(' ', COALESCE(NULLIF(trim(l.person), ''), c."contact_name"), ce."email", regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g')))
FROM "client_emails" ce
JOIN "clients" c ON c."id" = ce."client_id"
LEFT JOIN latest l ON l.email = ce."email"
LEFT JOIN "applicants" ap ON ap."email" = ce."email";--> statement-breakpoint
INSERT INTO "contact_emails" ("email", "contact_id") SELECT "primary_email", "id" FROM "contacts" WHERE "primary_email" IS NOT NULL ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "applications" SET "contact_id" = ce."contact_id" FROM "contact_emails" ce WHERE ce."email" = "applications"."applicant_email";--> statement-breakpoint
UPDATE "drafts" SET "contact_id" = ce."contact_id" FROM "contact_emails" ce WHERE ce."email" = "drafts"."email";--> statement-breakpoint
-- Accounts with no business name on any application are individuals (named after the person).
UPDATE "clients" c SET "is_individual" = true
WHERE NOT EXISTS (SELECT 1 FROM "applications" a WHERE a."client_id" = c."id" AND COALESCE(trim(a."business_name"), '') <> '')
	AND NOT EXISTS (SELECT 1 FROM "drafts" d WHERE d."client_id" = c."id" AND COALESCE(trim(d."business_name"), '') <> '');--> statement-breakpoint
-- Same rule as nameKey() in src/lib/clients/text.ts.
UPDATE "clients" SET "name_key" = trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower("name"), '&', ' and ', 'g'), '[^a-z0-9 ]', ' ', 'g'), '\m(the|llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited|pllc|lp|llp)\M', ' ', 'g'), '\s+', ' ', 'g'));
