ALTER TABLE "clients" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "deactivated_by" text;