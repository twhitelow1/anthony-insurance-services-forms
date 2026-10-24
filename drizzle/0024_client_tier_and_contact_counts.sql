ALTER TABLE "clients" ADD COLUMN "primary_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "primary_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_reports" ADD COLUMN "contact_counts" jsonb;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_primary_contact_id_contacts_id_fk" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_primary_contact_idx" ON "clients" USING btree ("primary_contact_id");
--> statement-breakpoint
-- Client tier: carry over the primary contact the app already had (the contact whose email is the
-- account's primary email), else the only contact, else the person on the latest application, else
-- the first contact, flagged for staff to check.
UPDATE "clients" c SET "primary_contact_id" = (
	SELECT ct.id FROM "contacts" ct
	WHERE ct.client_id = c.id AND c.primary_email IS NOT NULL AND lower(ct.primary_email) = lower(c.primary_email)
	ORDER BY ct.created_at LIMIT 1
) WHERE c.primary_contact_id IS NULL;
--> statement-breakpoint
UPDATE "clients" c SET "primary_contact_id" = (
	SELECT ct.id FROM "contacts" ct WHERE ct.client_id = c.id LIMIT 1
) WHERE c.primary_contact_id IS NULL AND (SELECT count(*) FROM "contacts" ct WHERE ct.client_id = c.id) = 1;
--> statement-breakpoint
UPDATE "clients" c SET "primary_contact_id" = (
	SELECT a.contact_id FROM "applications" a JOIN "contacts" ct ON ct.id = a.contact_id
	WHERE a.client_id = c.id AND ct.client_id = c.id
	ORDER BY a.created_at DESC LIMIT 1
) WHERE c.primary_contact_id IS NULL;
--> statement-breakpoint
UPDATE "clients" c SET "primary_contact_id" = (
	SELECT ct.id FROM "contacts" ct WHERE ct.client_id = c.id ORDER BY ct.created_at, ct.id LIMIT 1
), "primary_review" = true
WHERE c.primary_contact_id IS NULL AND EXISTS (SELECT 1 FROM "contacts" ct WHERE ct.client_id = c.id);
