"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { markNotDuplicates, mergeAccounts, MERGE_FIELDS, parseMergeKeys, type MergeField } from "@/lib/accounts/merge";
import { saveSyncReport } from "@/lib/bulk/report";
import { setFlash } from "@/lib/flash";
import { ghlConfig } from "@/lib/ghl/client";
import { links } from "@/lib/integrations/links";
import { salesforceClient } from "@/lib/salesforce/client";

// Accounts → Compare & merge. Every action re-checks the staff session. Nothing is deleted in
// Salesforce or Lead Alchemist (see lib/accounts/merge.ts).

const back = (formData: FormData) => {
  const b = String(formData.get("back") ?? "");
  return b.startsWith("/admin/clients") && !b.includes("//") ? b : "/admin/clients?view=all";
};

async function flashTo(to: string, tone: "ok" | "warn" | "error", text: string, href?: string): Promise<never> {
  const f = await setFlash({ tone, text, href });
  redirect(`${to}${to.includes("?") ? "&" : "?"}f=${f}`);
}

/** "Compare & merge selected" on the list: open the merge screen with the ticked rows (IDs only). */
export async function openMergeAction(formData: FormData) {
  await requireStaff();
  const keys = parseMergeKeys(formData.getAll("ids").map(String));
  if (keys.length < 2) return flashTo(back(formData), "error", "Tick two to four rows that are the same business, then Compare & merge.");
  redirect(`/admin/clients/merge?${new URLSearchParams({ keys: keys.join(","), back: back(formData) })}`);
}

export async function mergeAction(formData: FormData) {
  const staff = await requireStaff();
  const actor = `staff:${staff.email}`;
  const keys = parseMergeKeys(String(formData.get("keys") ?? "").split(","));
  const str = (k: string) => String(formData.get(k) ?? "").trim() || null;
  const values: Partial<Record<MergeField, string>> = {};
  for (const f of MERGE_FIELDS) {
    const v = str(`field_${f}`);
    if (v) values[f] = v.slice(0, 300);
  }
  let result: Awaited<ReturnType<typeof mergeAccounts>>;
  try {
    result = await mergeAccounts(
      { keys, keepApp: str("keepApp"), keepSf: str("keepSf"), keepLa: str("keepLa"), values, writeSf: formData.get("writeSf") === "yes", writeLa: formData.get("writeLa") === "yes" },
      actor,
      { sf: await salesforceClient(), links: await links(), laConnected: !!(await ghlConfig()) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[merge] failed:", message);
    return flashTo(`/admin/clients/merge?${new URLSearchParams({ keys: keys.join(","), back: back(formData) })}`, "error", message);
  }
  const report = await saveSyncReport({ title: "Merged", scope: `${result.records} records into one account`, page: `/admin/clients/${result.clientId}`, actor, total: 1, done: 1, notes: result.notes });
  revalidatePath("/admin/clients");
  const said = report.clean ? "No conflicts or errors." : `Needs attention: ${report.report.errors.length} error(s), ${report.report.conflicts.length} conflict(s).`;
  // From the Duplicates page, back to the list for the next group; otherwise to the account that stays.
  const fromDuplicates = back(formData).startsWith("/admin/clients/duplicates");
  return flashTo(
    fromDuplicates ? back(formData) : `/admin/clients/${result.clientId}`,
    report.clean ? "ok" : "warn",
    `Merged ${result.records} records into ${fromDuplicates ? "one account" : "this account"}. ${said}`,
    report.href,
  );
}

export async function notDuplicateAction(formData: FormData) {
  const staff = await requireStaff();
  const n = await markNotDuplicates(String(formData.get("keys") ?? "").split(","), `staff:${staff.email}`);
  revalidatePath("/admin/clients");
  return flashTo(back(formData), "ok", `Marked ${n} records as different businesses: they won't be suggested as a match again.`);
}
