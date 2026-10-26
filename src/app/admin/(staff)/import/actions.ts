"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { importRunIds, saveImportSourceMap } from "@/lib/applications/la-import";
import { startBackgroundRun, triggerSelectionRun } from "@/lib/bulk/background";
import { stopSelectionRun } from "@/lib/bulk/selection-run";
import { setFlash } from "@/lib/flash";

// Every action re-checks the staff session: server actions are reachable by direct POST.
// Importing only reads from Lead Alchemist; nothing is written or deleted there.

async function finish(tone: "ok" | "warn" | "error", text: string): Promise<never> {
  const f = await setFlash({ tone, text });
  revalidatePath("/admin/import");
  redirect(`/admin/import?f=${f}`);
}

/** Which of our forms each Lead Alchemist form or survey imports into. */
export async function saveImportMapAction(formData: FormData) {
  const staff = await requireStaff();
  const map: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("map:")) map[k.slice(4)] = String(v);
  await saveImportSourceMap(map, `staff:${staff.email}`);
  return finish("ok", "Saved which form each Lead Alchemist form imports into.");
}

/** Import every submission of the chosen forms, in the background. */
export async function startImportAction() {
  const staff = await requireStaff();
  try {
    const ids = await importRunIds();
    if (!ids.length) return finish("warn", "There are no submissions to import (or no Lead Alchemist form is set to import into one of ours).");
    await startBackgroundRun("la_import", { action: "importAll", label: "Imported old applications from Lead Alchemist", ids, scopeText: `${ids.length} page(s) of submissions` }, `staff:${staff.email}`);
  } catch (err) {
    return finish("error", err instanceof Error ? err.message : String(err));
  }
  return finish("ok", "Import started. It runs in the background; you can leave this page.");
}

export async function stepImportRunAction() {
  await requireStaff();
  await triggerSelectionRun("la_import");
  revalidatePath("/admin/import");
  redirect("/admin/import");
}

export async function stopImportRunAction() {
  const staff = await requireStaff();
  await stopSelectionRun("la_import", `staff:${staff.email}`);
  return finish("ok", "Stopped. Applications already imported stay.");
}
