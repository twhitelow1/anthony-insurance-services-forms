import "server-only";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { SyncJob } from "@/lib/db/schema";
import { addEvent } from "@/lib/applications/repo";
import { addClientEvent, setClientSalesforce } from "@/lib/clients/repo";
import { defaultSyncDeps, PermanentSyncError, syncApplicationToSalesforce, type SyncDeps, type SyncOutcome } from "./sync";

/**
 * The Salesforce sync runs after the applicant's submission is saved, never in its way.
 * Each application gets a job; a failure is retried with backoff (up to MAX_ATTEMPTS),
 * then shown in the admin with the error and a retry button.
 * Jobs run right after submit, whenever staff open the admin, and from the daily cron.
 */
export const MAX_ATTEMPTS = 5;
/** Wait before attempt 2, 3, 4, 5. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];

export const nextDelay = (attempts: number) => BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 1000);

/** Queue a sync for this application (one open job per application). */
export async function enqueueSalesforceSync(applicationId: string): Promise<number> {
  const db = await getDb();
  const [open] = await db
    .select()
    .from(schema.syncJobs)
    .where(and(eq(schema.syncJobs.kind, "salesforce_application"), eq(schema.syncJobs.targetId, applicationId), inArray(schema.syncJobs.status, ["pending", "running"])))
    .limit(1);
  if (open) {
    await db.update(schema.syncJobs).set({ nextAttemptAt: new Date(), updatedAt: new Date() }).where(eq(schema.syncJobs.id, open.id));
    return open.id;
  }
  const [job] = await db.insert(schema.syncJobs).values({ kind: "salesforce_application", targetId: applicationId }).returning({ id: schema.syncJobs.id });
  await db
    .update(schema.applications)
    .set({ sfSyncStatus: "pending", sfLastError: null })
    .where(and(eq(schema.applications.id, applicationId), eq(schema.applications.isTest, false)));
  return job.id;
}

/** Claim a job so two runners can't work on it at once. */
async function claim(id: number): Promise<SyncJob | null> {
  const db = await getDb();
  const [job] = await db
    .update(schema.syncJobs)
    .set({ status: "running", updatedAt: new Date() })
    .where(and(eq(schema.syncJobs.id, id), eq(schema.syncJobs.status, "pending")))
    .returning();
  return job ?? null;
}

export type JobResult = { jobId: number; outcome?: SyncOutcome; error?: string; final?: boolean };

/** Run one job now. Never throws: failures are recorded on the job, the application and its client. */
export async function runJob(id: number, depsOverride?: SyncDeps): Promise<JobResult> {
  const job = await claim(id);
  if (!job) return { jobId: id, error: "Already running or finished." };
  const db = await getDb();
  const deps = depsOverride ?? (await defaultSyncDeps());
  if ("off" in deps) {
    // Not an error with the application: leave it queued for when the sync is switched on.
    await db.update(schema.syncJobs).set({ status: "pending", lastError: deps.off, updatedAt: new Date() }).where(eq(schema.syncJobs.id, id));
    return { jobId: id, error: deps.off };
  }
  const attempts = job.attempts + 1;
  try {
    const outcome = await syncApplicationToSalesforce(job.targetId, deps);
    await db.update(schema.syncJobs).set({ status: "done", attempts, lastError: null, updatedAt: new Date() }).where(eq(schema.syncJobs.id, id));
    if (outcome.status === "dry_run") {
      await db.update(schema.applications).set({ sfSyncStatus: "not_synced" }).where(eq(schema.applications.id, job.targetId));
    }
    return { jobId: id, outcome };
  } catch (err) {
    const message = describe(err);
    const final = err instanceof PermanentSyncError || attempts >= MAX_ATTEMPTS;
    console.error(`[salesforce] sync attempt ${attempts} failed for application ${job.targetId}: ${message}`);
    await db
      .update(schema.syncJobs)
      .set({
        status: final ? "failed" : "pending",
        attempts,
        lastError: message,
        nextAttemptAt: new Date(Date.now() + (final ? 0 : nextDelay(attempts))),
        updatedAt: new Date(),
      })
      .where(eq(schema.syncJobs.id, id));
    const [app] = await db
      .update(schema.applications)
      .set({ sfSyncStatus: final ? "error" : "pending", sfLastError: message })
      .where(eq(schema.applications.id, job.targetId))
      .returning({ id: schema.applications.id, clientId: schema.applications.clientId, reference: schema.applications.reference });
    if (app && final) {
      await addEvent(app.id, "sf_sync_failed", "system", {
        message: `Salesforce sync failed after ${attempts} attempt(s): ${message}. Use "Sync to Salesforce" to try again.`,
      }).catch(() => {});
      if (app.clientId) {
        await setClientSalesforce(app.clientId, { sfStatus: "error", sfLastError: message }).catch(() => {});
        await addClientEvent(app.clientId, "sf_sync_failed", "system", { message: `${app.reference}: ${message}` }).catch(() => {});
      }
    }
    return { jobId: id, error: message, final };
  }
}

/** Run jobs that are due (newest submissions wait at most one backoff step). */
export async function runDueJobs(limit = 5): Promise<JobResult[]> {
  const db = await getDb();
  const due = await db
    .select({ id: schema.syncJobs.id })
    .from(schema.syncJobs)
    .where(and(eq(schema.syncJobs.status, "pending"), lte(schema.syncJobs.nextAttemptAt, new Date())))
    .orderBy(asc(schema.syncJobs.nextAttemptAt))
    .limit(limit);
  const results: JobResult[] = [];
  for (const { id } of due) results.push(await runJob(id));
  return results;
}

/** Run due jobs until the time budget is used up (the mapping screen's "Run queued syncs now"). */
export async function runQueuedJobs(budgetMs = 40_000): Promise<{ ran: number; failed: number; remaining: number; off?: string }> {
  // Sync off or not connected: the jobs stay queued for later.
  const deps = await defaultSyncDeps();
  if ("off" in deps) return { ran: 0, failed: 0, remaining: await queuedJobCount(), off: deps.off };
  const started = Date.now();
  let ran = 0;
  let failed = 0;
  while (Date.now() - started < budgetMs) {
    const results = await runDueJobs(1);
    if (!results.length) break;
    ran++;
    if (results[0].error) failed++;
  }
  return { ran, failed, remaining: await queuedJobCount() };
}

export async function queuedJobCount(): Promise<number> {
  const db = await getDb();
  return db.$count(schema.syncJobs, and(eq(schema.syncJobs.kind, "salesforce_application"), inArray(schema.syncJobs.status, ["pending", "running"])));
}

/** Staff "Sync to Salesforce": queue it (resetting a failed one) and run it now. */
export async function syncNow(applicationId: string, depsOverride?: SyncDeps): Promise<JobResult> {
  const db = await getDb();
  await db
    .update(schema.syncJobs)
    .set({ status: "done", updatedAt: new Date() })
    .where(and(eq(schema.syncJobs.kind, "salesforce_application"), eq(schema.syncJobs.targetId, applicationId), eq(schema.syncJobs.status, "failed")));
  const id = await enqueueSalesforceSync(applicationId);
  // A fresh start for the retry count.
  await db.update(schema.syncJobs).set({ attempts: 0 }).where(eq(schema.syncJobs.id, id));
  return runJob(id, depsOverride);
}

/** Open jobs for an application (for the admin: "queued, next try at …"). */
export async function jobsFor(applicationId: string) {
  const db = await getDb();
  return db
    .select()
    .from(schema.syncJobs)
    .where(and(eq(schema.syncJobs.kind, "salesforce_application"), eq(schema.syncJobs.targetId, applicationId)))
    .orderBy(asc(schema.syncJobs.createdAt));
}
