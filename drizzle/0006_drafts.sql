CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"form_slug" text NOT NULL,
	"email" text,
	"name" text,
	"business_name" text,
	"values" jsonb NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"application_id" uuid,
	"ghl_contact_id" text,
	"resume_emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drafts_status_idx" ON "drafts" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "drafts_email_idx" ON "drafts" USING btree ("email");