CREATE TABLE "directory_companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"name_key" text DEFAULT '' NOT NULL,
	"phone" text,
	"website" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory_contacts" ADD COLUMN "company_key" text;--> statement-breakpoint
CREATE INDEX "directory_companies_name_key_idx" ON "directory_companies" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "directory_companies_phone_idx" ON "directory_companies" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "contacts_lower_name_idx" ON "contacts" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "directory_contacts_lower_name_idx" ON "directory_contacts" USING btree (lower("name"));