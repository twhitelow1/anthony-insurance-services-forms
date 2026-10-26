"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import {
  accountDirectoryKeys,
  NO_ACCOUNT_TYPE,
  startAccountImport,
  stepAccountImport,
  type AccountMatchFilter,
  type AccountPresence,
  type AccountSource,
} from "@/lib/accounts/directory";
import { saveSyncReport } from "@/lib/bulk/report";
import { startBackgroundRun, triggerSelectionRun } from "@/lib/bulk/background";
import { INLINE_LIMIT, stopSelectionRun, type BatchResult } from "@/lib/bulk/selection-run";
import { CLIENT_SEARCH_COOKIE } from "@/lib/clients/search-cookie";
import { setFlash } from "@/lib/flash";
import { salesforceClient } from "@/lib/salesforce/client";
import { ACCOUNTS_WORK } from "@/lib/bulk/work/accounts";

// Accounts → "Across all three". Every action re-checks the staff session: server actions are
// reachable by direct POST. Nothing here deletes anything in Salesforce or Lead Alchemist.

const backTo = (formData: FormData) => {
  const b = String(formData.get("back") ?? "");
  return b.startsWith("/admin/clients") && !b.includes("//") ? b : "/admin/clients?view=all";
};

async function finish(to: string, tone: "ok" | "warn" | "error", text: string, href?: string): Promise<never> {
  const back = to.replace(/([?&])(f|importing)=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  const f = await setFlash({ tone, text, href });
  revalidatePath("/admin/clients");
  redirect(`${back}${back.includes("?") ? "&" : "?"}f=${f}`);
}

export async function searchAcrossAction(formData: FormData) {
  await requireStaff();
  const q = formData.get("clear") ? "" : String(formData.get("q") ?? "").trim().slice(0, 100);
  const jar = await cookies();
  if (q) jar.set(CLIENT_SEARCH_COOKIE, q, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/admin/clients", maxAge: 3600 });
  else jar.delete({ name: CLIENT_SEARCH_COOKIE, path: "/admin/clients" });
  redirect(backTo(formData).replace(/([?&])page=\d+&?/, "$1").replace(/[?&]$/, ""));
}

/** Refresh the copy of Salesforce Accounts or Lead Alchemist Companies: starts (or continues) it, one batch per call. */
export async function importAccountsAction(formData: FormData) {
  const staff = await requireStaff();
  const source: AccountSource = formData.get("source") === "lead_alchemist" ? "lead_alchemist" : "salesforce";
  if (formData.get("start") === "yes") await startAccountImport(source, `staff:${staff.email}`);
  const run = await stepAccountImport(source, { sf: source === "salesforce" ? await salesforceClient() : null });
  const back = backTo(formData).replace(/([?&])(f|importing)=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  if (run?.phase === "running") {
    revalidatePath("/admin/clients");
    redirect(`${back}${back.includes("?") ? "&" : "?"}importing=${source}`);
  }
  const label = source === "salesforce" ? "Salesforce Accounts" : "Lead Alchemist Companies";
  if (run?.phase === "failed") return finish(back, "error", `Reading ${label} stopped: ${run.error}. Press Refresh to start again.`);
  return finish(back, "ok", `Read ${run?.imported.toLocaleString("en-US") ?? 0} ${label}.`);
}

const WORK = ACCOUNTS_WORK;

const KEY_RE = /^[asl]:[A-Za-z0-9-]{3,64}$/;
const yesNo = (v: string | null): "yes" | "no" | undefined => (v === "yes" || v === "no" ? v : undefined);

async function listFilters(formData: FormData) {
  const p = new URL(backTo(formData), "http://x").searchParams;
  const presence: AccountPresence = { app: yesNo(p.get("app")), sf: yesNo(p.get("sf")), la: yesNo(p.get("la")) };
  const match = (["suggested", "none"] as AccountMatchFilter[]).find((m) => m === p.get("match"));
  const laMissing = p.get("lacontacts") === "missing";
  const type = p.get("type")?.slice(0, 80) || null;
  const q = (await cookies()).get(CLIENT_SEARCH_COOKIE)?.value ?? "";
  const words = [
    q && `matching "${q}"`,
    ...(["app", "sf", "la"] as const).filter((k) => presence[k]).map((k) => `${{ app: "AIS Connect", sf: "Salesforce", la: "Lead Alchemist" }[k]}: ${presence[k]}`),
    match && `suggested match: ${match === "suggested" ? "yes" : "no"}`,
    laMissing && "contacts not in Lead Alchemist yet",
    type && `Account Type: ${type === NO_ACCOUNT_TYPE ? "none" : type}`,
  ].filter(Boolean);
  return { q, presence, match, laMissing, type, text: words.length ? `Accounts ${words.join(", ")}` : "All accounts" };
}

async function bulk(formData: FormData, key: keyof typeof WORK): Promise<never> {
  const staff = await requireStaff();
  const { verb, options: optionNames, work } = WORK[key];
  const options = Object.fromEntries(optionNames.map((n) => [n, String(formData.get(n) ?? "")]));
  const actor = `staff:${staff.email}`;
  if (formData.get("allMatching") === "yes") {
    if (formData.get("confirmAll") !== "yes") return finish(backTo(formData), "error", "Tick the box to confirm running it on every matching account.");
    let started: number;
    try {
      const f = await listFilters(formData);
      started = (await startBackgroundRun("accounts", { action: key, label: verb, options, ids: await accountDirectoryKeys(f), scopeText: f.text }, actor)).ids.length;
    } catch (err) {
      return finish(backTo(formData), "error", err instanceof Error ? err.message : String(err));
    }
    return finish(backTo(formData), "ok", `Started on all ${started.toLocaleString("en-US")} matching accounts. Keep this page open; it continues on its own.`);
  }
  const keys = formData.getAll("ids").map(String).filter((v) => KEY_RE.test(v)).slice(0, 200);
  if (!keys.length) return finish(backTo(formData), "error", "Tick at least one account first.");
  // More than a few: run in batches that continue on their own, with one report at the end.
  const asRun = async (ids: string[], scopeText: string, prefix = "") => {
    try {
      await startBackgroundRun("accounts", { action: key, label: verb, options, ids, scopeText }, actor);
    } catch (err) {
      return finish(backTo(formData), "error", err instanceof Error ? err.message : String(err));
    }
    return finish(backTo(formData), "ok", `${prefix}Running on ${ids.length.toLocaleString("en-US")} accounts in batches. Keep this page open; it continues on its own and ends with a sync report.`);
  };
  if (keys.length > INLINE_LIMIT) return asRun(keys, `${keys.length} ticked on Accounts → Across all three`);
  let r: BatchResult;
  try {
    r = await work(keys, actor, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[accounts] bulk action failed:", message);
    return finish(backTo(formData), "error", message);
  }
  const report = await saveSyncReport({ title: verb, scope: `${keys.length} ticked on Accounts → Across all three`, page: backTo(formData), actor, total: keys.length, done: r.done, notes: r.notes, contacts: r.contacts });
  if (r.notReached?.length) return asRun(r.notReached, `the rest of ${keys.length} ticked on Accounts → Across all three`, `${report.text} `);
  return finish(backTo(formData), report.clean ? "ok" : "warn", report.text, report.href);
}

export async function addAccountsToAppAction(formData: FormData) {
  return bulk(formData, "addToApp");
}

export async function accountsToLeadAlchemistAction(formData: FormData) {
  return bulk(formData, "toLeadAlchemist");
}

export async function accountsToSalesforceAction(formData: FormData) {
  return bulk(formData, "toSalesforce");
}

export async function linkSuggestedAction(formData: FormData) {
  return bulk(formData, "linkSuggested");
}

/** "Continue": set the run working in the background again (it normally carries on by itself). */
export async function stepAccountsRunAction(formData: FormData) {
  await requireStaff();
  await triggerSelectionRun("accounts");
  revalidatePath("/admin/clients");
  redirect(backTo(formData));
}

export async function stopAccountsRunAction(formData: FormData) {
  const staff = await requireStaff();
  await stopSelectionRun("accounts", `staff:${staff.email}`);
  return finish(backTo(formData), "ok", "Stopped. Accounts already done stay done.");
}
