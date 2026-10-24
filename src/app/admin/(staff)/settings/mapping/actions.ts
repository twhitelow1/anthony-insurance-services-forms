"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import type { MappingKind } from "@/lib/db/schema";
import { ghlConfig } from "@/lib/ghl/client";
import { links } from "@/lib/integrations/links";
import { applyCompaniesBatch, scanCompaniesBatch } from "@/lib/mapping/la-companies";
import { confirmRun, getRun, saveDecisions, saveRun, startRun, type MappingRun } from "@/lib/mapping/runs";
import { applySalesforceBatch, scanSalesforceBatch } from "@/lib/mapping/salesforce-import";
import { applyPushBatch, scanPushBatch } from "@/lib/mapping/salesforce-push";
import { salesforceClient } from "@/lib/salesforce/client";
import { runQueuedJobs } from "@/lib/salesforce/jobs";
import { KIND_SLUGS, slugFor } from "./kinds";

// Every action re-checks the staff session: server actions are reachable by direct POST.

const kindOf = (formData: FormData): MappingKind => {
  const kind = KIND_SLUGS[String(formData.get("kind") ?? "")];
  if (!kind) throw new Error("Unknown mapping");
  return kind;
};
const page = (kind: MappingKind, params: Record<string, string> = {}): never =>
  redirect(`/admin/settings/mapping/${slugFor(kind)}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ""}`);

function needsConnection(kind: MappingKind): string | null {
  if (kind !== "la_companies" && !salesforceClient()) return "salesforce";
  if (kind === "la_companies" && !ghlConfig()) return "lead_alchemist";
  return null;
}

/** One scan or apply batch for the run's current phase. */
async function step(run: MappingRun): Promise<MappingRun> {
  if (run.kind === "la_companies") return run.phase === "scanning" ? scanCompaniesBatch(run) : applyCompaniesBatch(run);
  const sf = salesforceClient()!;
  if (run.kind === "salesforce_import") {
    const deps = { sf, links: await links() };
    return run.phase === "scanning" ? scanSalesforceBatch(run, deps) : applySalesforceBatch(run, deps);
  }
  return run.phase === "scanning" ? scanPushBatch(run, { sf }) : applyPushBatch(run, { sf });
}

async function stepSafely(run: MappingRun): Promise<string | null> {
  try {
    await step(run);
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mapping] ${run.kind} ${run.phase} failed:`, message);
    await saveRun({ ...run, stoppedReason: message.slice(0, 300) });
    return "step_failed";
  }
}

export async function startScanAction(formData: FormData) {
  const staff = await requireStaff();
  const kind = kindOf(formData);
  const missing = needsConnection(kind);
  if (missing) page(kind, { error: missing });
  const run = await startRun(kind, `staff:${staff.email}`);
  const err = await stepSafely(run);
  page(kind, err ? { error: err } : {});
}

/** The next batch of the scan or of applying (the page submits this again until it's done). */
export async function continueAction(formData: FormData) {
  await requireStaff();
  const kind = kindOf(formData);
  const run = await getRun(kind);
  if (!run || (run.phase !== "scanning" && run.phase !== "applying")) page(kind);
  if (needsConnection(kind)) page(kind, { error: needsConnection(kind)! });
  const err = await stepSafely({ ...run!, stoppedReason: undefined });
  revalidatePath(`/admin/settings/mapping/${slugFor(kind)}`);
  page(kind, err ? { error: err } : {});
}

/** Save the choices in the table: "link:<id>", "create" or "skip" per row. */
export async function saveDecisionsAction(formData: FormData) {
  await requireStaff();
  const kind = kindOf(formData);
  const run = await getRun(kind);
  if (!run || run.phase !== "review") page(kind, { error: "not_review" });
  const decisions: Record<number, string> = {};
  for (const [k, v] of formData.entries()) {
    const m = k.match(/^d_(\d+)$/);
    if (m && typeof v === "string") decisions[Number(m[1])] = v;
  }
  const n = await saveDecisions(run!.runId, decisions);
  const back = String(formData.get("back") ?? "");
  const params = new URLSearchParams(back.startsWith("?") ? back.slice(1) : "");
  params.set("saved", String(n));
  page(kind, Object.fromEntries(params));
}

/** Staff confirmed: apply the mapping as reviewed. */
export async function confirmAction(formData: FormData) {
  const staff = await requireStaff();
  const kind = kindOf(formData);
  if (formData.get("reviewed") !== "yes") page(kind, { error: "not_confirmed" });
  if (needsConnection(kind)) page(kind, { error: needsConnection(kind)! });
  const options = { createContacts: formData.get("createContacts") === "yes", moveContacts: formData.get("moveContacts") === "yes" };
  let run: MappingRun;
  try {
    run = await confirmRun(kind, `staff:${staff.email}`, options);
  } catch {
    page(kind, { error: "not_review" });
  }
  console.info(`[mapping] ${kind} confirmed by staff; applying`);
  const err = await stepSafely(run!);
  page(kind, err ? { error: err } : {});
}

/** Past applications → Salesforce: run the queued syncs now instead of waiting for the daily run. */
export async function runQueuedSyncsAction(formData: FormData) {
  await requireStaff();
  const kind = kindOf(formData);
  if (!salesforceClient()) page(kind, { error: "salesforce" });
  const r = await runQueuedJobs(40_000);
  if (r.off) page(kind, { error: "sync_off" });
  page(kind, { ran: String(r.ran), failed: String(r.failed), remaining: String(r.remaining) });
}
