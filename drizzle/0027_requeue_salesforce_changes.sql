-- Salesforce changes that failed on "duplicate field selected: Type" (fixed in this release): try them again.
UPDATE "sync_jobs" SET "status" = 'pending', "attempts" = 0, "last_error" = NULL, "next_attempt_at" = now(), "updated_at" = now()
WHERE "kind" = 'salesforce_inbound' AND "status" = 'failed';
