CREATE TABLE "contact_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" uuid NOT NULL,
	"client_id" uuid,
	"system" text NOT NULL,
	"direction" text NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_changes" ADD CONSTRAINT "contact_changes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_changes_contact_idx" ON "contact_changes" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_changes_created_idx" ON "contact_changes" USING btree ("created_at");