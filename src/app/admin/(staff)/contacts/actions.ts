"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { saveSyncReport } from "@/lib/bulk/report";
import { startSelectionRun, stepSelectionRun, stopSelectionRun, type BatchResult } from "@/lib/bulk/selection-run";
import {
  addSelectedToApp,
  directoryKeys,
  sendToLeadAlchemist,
  sendToSalesforce,
  startImport,
  stepImport,
  updateLeadAlchemistForSelected,
  type CompanyState,
  type DirectoryFilter,
  type DirectorySource,
  type Presence,
} from "@/lib/contacts/directory";
import { setFlash } from "@/lib/flash";
import { links } from "@/lib/integrations/links";
import { salesforceClient } from "@/lib/salesforce/client";
import { CONTACT_SEARCH_COOKIE } from "./search-cookie";

// Every action re-checks the staff session: server actions are reachable by direct POST.
// Nothing here deletes anything in Salesforce or Lead Alchemist.

const backTo = (formData: FormData) => {
  const b = String(formData.get("back") ?? "");
  return b.startsWith("/admin/contacts") && !b.includes("//") ? b : "/admin/contacts";
};

async function finish(to: string, tone: "ok" | "warn" | "error", text: string, href?: string): Promise<never> {
  const back = to.replace(/([?&])(f|importing)=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  const f = await setFlash({ tone, text, href });
  revalidatePath("/admin/contacts");
  redirect(`${back}${back.includes("?") ? "&" : "?"}f=${f}`);
}

const selected = (formData: FormData) => formData.getAll("ids").map(String);

type Work = (values: string[], actor: string, options: Record<string, string>) => Promise<BatchResult>;

/** The bulk buttons, by key, so a "select all matching" run can call the same work later. */
const WORK: Record<string, { verb: string; options: string[]; work: Work }> = {
  addToApp: {
    verb: "Added to AIS Connect",
    options: [],
    work: async (values, actor) => addSelectedToApp(values, actor, { sf: await salesforceClient(), links: await links() }),
  },
  toLeadAlchemist: {
    verb: "Synced to Lead Alchemist",
    options: ["createMissing"],
    work: async (values, actor, o) => sendToLeadAlchemist(values, actor, { sf: await salesforceClient(), links: await links() }, o.createMissing === "yes"),
  },
  toSalesforce: {
    verb: "Linked or created in Salesforce",
    options: [],
    work: async (values, actor) => {
      const sf = await salesforceClient();
      if (!sf) throw new Error("Salesforce isn't connected. Add the keys in Settings → Integrations.");
      return sendToSalesforce(values, actor, { sf, links: await links() });
    },
  },
  updateLa: {
    verb: "Updated in Lead Alchemist",
    options: ["replace"],
    work: (values, actor, o) => updateLeadAlchemistForSelected(values, actor, o.replace === "yes"),
  },
};

const FILTERS: DirectoryFilter[] = ["all", "app_only", "sf_only", "la_only", "not_app", "not_sf", "not_la", "everywhere", "la_outdated", "possible_dup"];
const COMPANY: CompanyState[] = ["linked", "suggested", "none"];
const yesNo = (v: string | null): "yes" | "no" | undefined => (v === "yes" || v === "no" ? v : undefined);

/** The list's filters, read from the page address the form came from (plus the search cookie). */
async function listFilters(formData: FormData) {
  const p = new URL(backTo(formData), "http://x").searchParams;
  const filter = FILTERS.find((f) => f === p.get("filter")) ?? "all";
  const presence: Presence = { app: yesNo(p.get("app")), sf: yesNo(p.get("sf")), la: yesNo(p.get("la")) };
  const account = yesNo(p.get("account"));
  const company = COMPANY.find((c) => c === p.get("company"));
  const q = (await cookies()).get(CONTACT_SEARCH_COOKIE)?.value ?? "";
  const words = [
    q && `matching "${q}"`,
    filter !== "all" && `filter: ${filter.replace(/_/g, " ")}`,
    ...(["app", "sf", "la"] as const).filter((k) => presence[k]).map((k) => `${{ app: "AIS Connect", sf: "Salesforce", la: "Lead Alchemist" }[k]}: ${presence[k]}`),
    account && `account in AIS Connect: ${account}`,
    company && `Lead Alchemist Company: ${company}`,
  ].filter(Boolean);
  return { q, filter, presence, account, company, text: words.length ? `Contacts ${words.join(", ")}` : "All contacts" };
}

async function bulk(formData: FormData, key: keyof typeof WORK): Promise<never> {
  const staff = await requireStaff();
  const { verb, options: optionNames, work } = WORK[key];
  const options = Object.fromEntries(optionNames.map((n) => [n, String(formData.get(n) ?? "")]));
  const actor = `staff:${staff.email}`;
  if (formData.get("allMatching") === "yes") {
    if (formData.get("confirmAll") !== "yes") return finish(backTo(formData), "error", "Tick the box to confirm running it on every matching person.");
    let started: number;
    try {
      const f = await listFilters(formData);
      started = (await startSelectionRun("contacts", { action: key, label: verb, options, ids: await directoryKeys(f), scopeText: f.text }, actor)).ids.length;
    } catch (err) {
      return finish(backTo(formData), "error", err instanceof Error ? err.message : String(err));
    }
    return finish(backTo(formData), "ok", `Started on all ${started.toLocaleString("en-US")} matching people. Keep this page open; it continues on its own.`);
  }
  const values = selected(formData);
  if (!values.length) return finish(backTo(formData), "error", "Tick at least one person first.");
  let r: BatchResult;
  try {
    r = await work(values, actor, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[contacts] bulk action failed:", message);
    return finish(backTo(formData), "error", message);
  }
  const report = await saveSyncReport({ title: verb, scope: `${values.length} ticked on Contacts`, page: backTo(formData), actor, total: values.length, done: r.done, notes: r.notes });
  return finish(backTo(formData), report.clean ? "ok" : "warn", report.text, report.href);
}

/** One batch of a "select all matching" run; the progress panel submits this again until it's done. */
export async function stepContactsRunAction(formData: FormData) {
  await requireStaff();
  const run = await stepSelectionRun("contacts", (r) => {
    const w = WORK[r.action];
    return w ? (ids, actor) => w.work(ids, actor, r.options) : null;
  });
  if (run?.phase === "stopped" && run.error) console.error("[contacts] run stopped:", run.error);
  revalidatePath("/admin/contacts");
  redirect(backTo(formData));
}

export async function stopContactsRunAction(formData: FormData) {
  const staff = await requireStaff();
  await stopSelectionRun("contacts", `staff:${staff.email}`);
  return finish(backTo(formData), "ok", "Stopped. People already done stay done.");
}

export async function searchContactsAction(formData: FormData) {
  await requireStaff();
  const q = formData.get("clear") ? "" : String(formData.get("q") ?? "").trim().slice(0, 100);
  const jar = await cookies();
  if (q) jar.set(CONTACT_SEARCH_COOKIE, q, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/admin/contacts", maxAge: 3600 });
  else jar.delete({ name: CONTACT_SEARCH_COOKIE, path: "/admin/contacts" });
  redirect(backTo(formData).replace(/([?&])page=\d+&?/, "$1").replace(/[?&]$/, ""));
}

export async function addToAppAction(formData: FormData) {
  return bulk(formData, "addToApp");
}

export async function sendToLeadAlchemistAction(formData: FormData) {
  return bulk(formData, "toLeadAlchemist");
}

export async function sendToSalesforceAction(formData: FormData) {
  return bulk(formData, "toSalesforce");
}

export async function updateLaDetailsAction(formData: FormData) {
  return bulk(formData, "updateLa");
}

const sourceOf = (formData: FormData): DirectorySource => (formData.get("source") === "lead_alchemist" ? "lead_alchemist" : "salesforce");

/** Refresh the directory from Salesforce or Lead Alchemist: starts (or continues) the import, one batch per call. */
export async function importAction(formData: FormData) {
  const staff = await requireStaff();
  const source = sourceOf(formData);
  if (formData.get("start") === "yes") await startImport(source, `staff:${staff.email}`);
  const run = await stepImport(source, { sf: source === "salesforce" ? await salesforceClient() : null });
  const back = backTo(formData).replace(/([?&])(f|importing)=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  if (run?.phase === "running") {
    revalidatePath("/admin/contacts");
    redirect(`${back}${back.includes("?") ? "&" : "?"}importing=${source}`);
  }
  const label = source === "salesforce" ? "Salesforce" : "Lead Alchemist";
  if (run?.phase === "failed") return finish(back, "error", `Reading ${label} contacts stopped: ${run.error}. Press Refresh to start again.`);
  return finish(back, "ok", `Read ${run?.imported.toLocaleString("en-US") ?? 0} ${label} contacts.`);
}
