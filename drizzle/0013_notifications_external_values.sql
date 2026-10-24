CREATE TABLE "notification_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"notification_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"data" jsonb,
	"client_id" uuid,
	"contact_id" uuid,
	"application_id" uuid,
	"dedupe_key" text,
	"assigned_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "sf_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "sf_email" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "sf_phone" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "la_email" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "la_phone" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "external_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_log_notification_idx" ON "notification_log" USING btree ("notification_id","at");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "notifications_client_idx" ON "notifications" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("dedupe_key");