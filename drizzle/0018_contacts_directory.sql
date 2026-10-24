CREATE TABLE "directory_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email" text,
	"phone" text,
	"company_id" text,
	"company_name" text,
	"app_contact_id" uuid,
	"match_how" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "directory_contacts" ADD CONSTRAINT "directory_contacts_app_contact_id_contacts_id_fk" FOREIGN KEY ("app_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "directory_contacts_source_ext_idx" ON "directory_contacts" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "directory_contacts_app_idx" ON "directory_contacts" USING btree ("app_contact_id");--> statement-breakpoint
CREATE INDEX "directory_contacts_email_idx" ON "directory_contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "directory_contacts_phone_idx" ON "directory_contacts" USING btree ("phone");