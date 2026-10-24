CREATE TABLE "directory_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"name_key" text DEFAULT '' NOT NULL,
	"phone" text,
	"website" text,
	"type" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "directory_accounts_name_key_idx" ON "directory_accounts" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "directory_accounts_phone_idx" ON "directory_accounts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "directory_contacts_company_idx" ON "directory_contacts" USING btree ("source","company_id");