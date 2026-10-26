"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { importRunIds, pickedItem, reverseImportRun, saveImportSourceMap, undoImport } from "@/lib/applications/la-import";
import { startBackgroundRun, triggerSelectionRun } from "@/lib/bulk/background";
import { stopSelectionRun } from "@/lib/bulk/selection-run";
import { setFlash } from "@/lib/flash";

// Every action re-checks the staff session: server actions are reachable by direct POST.
// Importing only reads from Lead Alchemist; nothing is written or deleted there.

const SOURCE = /^(form|survey):[A-Za-z0-9]{6,64}$/;
const SUBMISSION = /^[A-Za-z0-9-]{6,64}$/;

async function finish(tone: "ok" | "warn" | "error", text: string, back = "/admin/import"): Promise<never> {
  const f = await setFlash({ tone, text });
  revalidatePath("/admin/import");
  redirect(`${back}${back.includes("?") ? "&" : "?"}f=${f}`);
}

async function start(ids: string[], scopeText: string, actor: string, back?: string): Promise<never> {
  try {
    await startBackgroundRun("la_import", { action: "importAll", label: "Imported old applications from Lead Alchemist", ids, scopeText }, actor);
  } catch (err) {
    return finish("error", err instanceof Error ? err.message : String(err), back);
  }
  return finish("ok", "Import started. It runs in the background; you can leave this page.", back);
}

/** Save the "Imports into" dropdowns as they are on the page (every import button does this first). */
async function saveMap(formData: FormData, actor: string) {
  const map: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("map:")) map[k.slice(4)] = String(v);
  if (Object.keys(map).length) await saveImportSourceMap(map, actor);
}

/** Which of our forms each Lead Alchemist form or survey imports into. */
export async function saveImportMapAction(formData: FormData) {
  const staff = await requireStaff();
  await saveMap(formData, `staff:${staff.email}`);
  return finish("ok", "Saved which form each Lead Alchemist form imports into.");
}

/** Import every submission of every Lead Alchemist form set to import, in the background. */
export async function startImportAction(formData: FormData) {
  const staff = await requireStaff();
  await saveMap(formData, `staff:${staff.email}`);
  const ids = await importRunIds().catch((err) => finish("error", err instanceof Error ? err.message : String(err)));
  if (!ids.length) return finish("warn", "There are no submissions to import (or no Lead Alchemist form is set to import into one of ours).");
  return start(ids, `All forms: ${ids.length} page(s) of submissions`, `staff:${staff.email}`);
}

/** Import every submission of just the Lead Alchemist forms and surveys ticked. */
export async function importSelectedAction(formData: FormData) {
  const staff = await requireStaff();
  await saveMap(formData, `staff:${staff.email}`);
  const keys = formData.getAll("ids").map(String).filter((k) => SOURCE.test(k));
  if (!keys.length) return finish("warn", "Tick the Lead Alchemist forms or surveys to import first.");
  const ids = await importRunIds(keys).catch((err) => finish("error", err instanceof Error ? err.message : String(err)));
  if (!ids.length) return finish("warn", "Those have no submissions, or aren't set to import into one of our forms (pick one and Save first).");
  return start(ids, `${keys.length} form(s): ${ids.length} page(s) of submissions`, `staff:${staff.email}`);
}

/** Import just the submissions ticked on one page of a form's submissions. */
export async function importPickedAction(formData: FormData) {
  const staff = await requireStaff();
  const key = String(formData.get("source") ?? "");
  const page = Math.max(1, Number(formData.get("page")) || 1);
  const back = `/admin/import?source=${encodeURIComponent(key)}&page=${page}`;
  const picked = formData.getAll("ids").map(String).filter((v) => SUBMISSION.test(v));
  if (!SOURCE.test(key) || !picked.length) return finish("warn", "Tick the submissions to import first.", back);
  return start([pickedItem(key, page, picked)], `${picked.length} ticked submission(s)`, `staff:${staff.email}`, back);
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

/** Undo the import of one Lead Alchemist form: remove the applications it brought into AIS Connect. */
export async function undoImportAction(formData: FormData) {
  const staff = await requireStaff();
  const key = String(formData.get("source") ?? "");
  const back = `/admin/import?source=${encodeURIComponent(key)}`;
  if (!SOURCE.test(key)) return finish("error", "Unknown Lead Alchemist form.");
  if (formData.get("confirm") !== "yes") return finish("warn", "Tick the box to confirm first.", back);
  const n = await undoImport(key);
  console.info(`[import] ${staff.email} removed ${n} imported application(s) from ${key}`);
  return finish("ok", `Removed ${n} imported application${n === 1 ? "" : "s"} from AIS Connect. Nothing changed in Lead Alchemist; accounts and contacts stay.`, back);
}

/** Reverse one past import run (from the Import history): remove the applications it brought in. */
export async function reverseImportRunAction(formData: FormData) {
  const staff = await requireStaff();
  const key = String(formData.get("run") ?? "").slice(0, 300);
  if (!key) return finish("error", "Unknown import.");
  if (formData.get("confirm") !== "yes") return finish("warn", "Tick the box next to Reverse to confirm first.");
  const n = await reverseImportRun(key);
  console.info(`[import] ${staff.email} reversed import ${key}: ${n} application(s) removed`);
  return finish("ok", `Reversed: removed ${n} imported application${n === 1 ? "" : "s"} from AIS Connect. Nothing changed in Lead Alchemist; accounts and contacts stay.`);
}
