"use server";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { getBackfillState, runBackfillBatch, startBackfill } from "@/lib/salesforce/backfill";
import { salesforceClient } from "@/lib/salesforce/client";
import { links } from "@/lib/integrations/links";

async function run(actor: string) {
  const sf = salesforceClient();
  if (!sf) redirect("/admin/clients/backfill?error=not_connected");
  try {
    await runBackfillBatch({ sf, links: await links(), timeBudgetMs: 40_000 }, actor);
  } catch (err) {
    console.error("[salesforce] backfill batch failed", err);
    redirect("/admin/clients/backfill?error=batch_failed");
  }
  redirect("/admin/clients/backfill");
}

export async function startDryRunAction() {
  const staff = await requireStaff();
  await startBackfill("dry_run", `staff:${staff.email}`);
  await run(`staff:${staff.email}`);
}

export async function startApplyAction(formData: FormData) {
  const staff = await requireStaff();
  const prev = await getBackfillState();
  if (!prev || prev.mode !== "dry_run" || !prev.done) redirect("/admin/clients/backfill?error=dry_run_first");
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "LINK") redirect("/admin/clients/backfill?error=confirm");
  await startBackfill("apply", `staff:${staff.email}`);
  await run(`staff:${staff.email}`);
}

export async function continueBackfillAction() {
  const staff = await requireStaff();
  await run(`staff:${staff.email}`);
}
