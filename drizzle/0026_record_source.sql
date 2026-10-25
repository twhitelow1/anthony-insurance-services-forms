ALTER TABLE "clients" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
-- Backfill: made by an application (or unfinished one) at the time, else imported from Salesforce or Lead Alchemist when linked, else added by staff.
UPDATE "clients" c SET "source" = CASE
  WHEN EXISTS (SELECT 1 FROM "applications" a WHERE a."client_id" = c."id" AND abs(extract(epoch FROM a."created_at" - c."created_at")) <= 600)
    OR EXISTS (SELECT 1 FROM "drafts" d WHERE d."client_id" = c."id" AND abs(extract(epoch FROM d."created_at" - c."created_at")) <= 600) THEN 'application'
  WHEN c."sf_account_id" IS NOT NULL THEN 'salesforce'
  WHEN c."ghl_company_id" IS NOT NULL THEN 'lead_alchemist'
  ELSE 'manual' END;--> statement-breakpoint
UPDATE "contacts" p SET "source" = CASE
  WHEN EXISTS (SELECT 1 FROM "applications" a WHERE a."contact_id" = p."id" AND abs(extract(epoch FROM a."created_at" - p."created_at")) <= 600)
    OR EXISTS (SELECT 1 FROM "drafts" d WHERE d."contact_id" = p."id" AND abs(extract(epoch FROM d."created_at" - p."created_at")) <= 600) THEN 'application'
  WHEN p."sf_contact_id" IS NOT NULL THEN 'salesforce'
  WHEN p."ghl_contact_id" IS NOT NULL THEN 'lead_alchemist'
  ELSE 'manual' END;
