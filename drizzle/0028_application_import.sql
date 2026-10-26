ALTER TABLE "applications" ADD COLUMN "imported_from" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "la_submission_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_la_submission_idx" ON "applications" USING btree ("la_submission_id");