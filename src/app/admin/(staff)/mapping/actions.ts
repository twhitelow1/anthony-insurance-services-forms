"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { setFlash } from "@/lib/flash";
import { ghlConfig } from "@/lib/ghl/client";
import { links } from "@/lib/integrations/links";
import { saveSyncReport } from "@/lib/bulk/report";
import { startSelectionRun, stepSelectionRun, stopSelectionRun } from "@/lib/bulk/selection-run";
import { findLaMatches, resetLaMatches } from "@/lib/mapping/la-matches";
import type { CompanyFilter } from "@/lib/mapping/company-match";
import {
  accountMapIds,
  addCompaniesToApp,
  contactMapIds,
  listCompanyMatches,
  multiAccountContactIds,
  type AccountMapFilter,
  type ContactMapFilter,
  companiesToSalesforce,
  connectSelectedContacts,
  createAccountsInSalesforce,
  createContactsInSalesforce,
  linkCompaniesToAccounts,
  linkContactsToLeadAlchemist,
  pushCompanyTags,
  syncAccountsToLeadAlchemist,
  type BulkResult,
} from "@/lib/mapping/database";
import { salesforceClient } from "@/lib/salesforce/client";
import { MAP_SEARCH_COOKIE } from "./search-cookie";

// Every action re-checks the staff session: server actions are reachable by direct POST.
// None of these delete anything in Salesforce or Lead Alchemist.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LA_ID = /^[A-Za-z0-9]{6,64}$/;

const backTo = (formData: FormData) => {
  const b = String(formData.get("back") ?? "");
  return b.startsWith("/admin/mapping") && !b.includes("//") ? b : "/admin/mapping";
};

async function finish(formData: FormData, tone: "ok" | "warn" | "error", text: string, href?: string): Promise<never> {
  return finishTo(backTo(formData), tone, text, href);
}

async function finishTo(to: string, tone: "ok" | "warn" | "error", text: string, href?: string): Promise<never> {
  const back = to.replace(/([?&])f=[^&]*&?/, "$1").replace(/[?&]$/, "");
  const f = await setFlash({ tone, text, href });
  revalidatePath("/admin/mapping");
  redirect(`${back}${back.includes("?") ? "&" : "?"}f=${f}`);
}

const PAIR = /^[A-Za-z0-9]{6,64}:[0-9a-f-]{36}$/;
const selected = (formData: FormData, re: RegExp) => formData.getAll("ids").map(String).filter((v) => re.test(v));

type Tab = "accounts" | "contacts" | "companies" | "multi";
type Work = (ids: string[], actor: string, options: Record<string, string>) => Promise<BulkResult>;

/**
 * The bulk buttons, by key: which list they belong to, what a row value looks like, and the work,
 * so a "select all matching" run can call the same work later. Linking Companies takes
 * "<Company ID>:<Account ID>" pairs (the account chosen in the row, or the top suggestion).
 */
const WORK: Record<string, { tab: Tab; re: RegExp; verb: string; options: string[]; work: Work }> = {
  accountsToLa: {
    tab: "accounts",
    re: UUID,
    verb: "Synced to Lead Alchemist",
    options: ["createMissing"],
    work: async (ids, actor, o) => syncAccountsToLeadAlchemist(ids, actor, { sf: await salesforceClient(), links: await links() }, { createMissing: o.createMissing === "yes" }),
  },
  accountsToSf: {
    tab: "accounts",
    re: UUID,
    verb: "Linked or created in Salesforce",
    options: [],
    work: async (ids, actor) => createAccountsInSalesforce(ids, actor, { sf: await sf(), links: await links() }),
  },
  contactsToLa: { tab: "contacts", re: UUID, verb: "Linked to Lead Alchemist", options: [], work: (ids, actor) => linkContactsToLeadAlchemist(ids, actor) },
  contactsToCompany: {
    tab: "contacts",
    re: UUID,
    verb: "Synced to Lead Alchemist",
    options: ["createMissing"],
    work: (ids, actor, o) => connectSelectedContacts(ids, actor, { createMissing: o.createMissing === "yes" }),
  },
  contactsToSf: {
    tab: "contacts",
    re: UUID,
    verb: "Linked or created in Salesforce",
    options: [],
    work: async (ids, actor) => createContactsInSalesforce(ids, actor, { sf: await sf(), links: await links() }),
  },
  companiesToSf: {
    tab: "companies",
    re: LA_ID,
    verb: "Linked or created in Salesforce",
    options: [],
    work: async (ids, actor) => companiesToSalesforce(ids, actor, { sf: await sf(), links: await links() }),
  },
  linkCompanies: {
    tab: "companies",
    re: PAIR,
    verb: "Linked to accounts in AIS Connect",
    options: [],
    work: (pairs, actor) =>
      linkCompaniesToAccounts(
        pairs.map((p) => p.split(":")).map(([businessId, accountId]) => ({ businessId, accountId })),
        actor,
      ),
  },
  addCompanies: { tab: "companies", re: LA_ID, verb: "Added to AIS Connect", options: [], work: (ids, actor) => addCompaniesToApp(ids, actor) },
  companyTags: { tab: "multi", re: UUID, verb: "Company tags added in Lead Alchemist", options: [], work: (ids, actor) => pushCompanyTags(ids, actor) },
};

const ACCOUNT_FILTERS: AccountMapFilter[] = ["all", "sf_not_la", "la_not_sf", "neither", "both", "la_suggested"];
const CONTACT_FILTERS: ContactMapFilter[] = ["all", "no_la", "no_sf", "la_company_check", "la_suggested"];
const COMPANY_FILTERS: CompanyFilter[] = ["unlinked", "strong", "possible", "none", "linked", "all"];

/** Every row value the list shows for its current filters (all pages), read from the page address plus the search cookie. */
async function matchingIds(formData: FormData, key: string): Promise<{ ids: string[]; text: string }> {
  const p = new URL(backTo(formData), "http://x").searchParams;
  const filter = p.get("filter") ?? "";
  const q = (await cookies()).get(MAP_SEARCH_COOKIE)?.value ?? "";
  const type = (p.get("type") ?? "").slice(0, 80);
  const words = (list: string) => [list, q && `matching "${q}"`, filter && `filter: ${filter.replace(/_/g, " ")}`, type && `type: ${type}`].filter(Boolean).join(", ");
  switch (WORK[key].tab) {
    case "accounts":
      return { ids: await accountMapIds({ q, filter: ACCOUNT_FILTERS.find((f) => f === filter) ?? "all", type: type || null }), text: words("Accounts") };
    case "contacts":
      return { ids: await contactMapIds({ q, filter: CONTACT_FILTERS.find((f) => f === filter) ?? "all" }), text: words("Contacts") };
    case "multi":
      return { ids: await multiAccountContactIds(), text: "People at several companies" };
    case "companies": {
      const { rows } = await listCompanyMatches({ q, filter: COMPANY_FILTERS.find((f) => f === filter) ?? "unlinked" });
      const ids =
        key === "linkCompanies"
          ? rows.flatMap((r) => (r.suggestions[0] && !r.linked ? [`${r.business.id}:${r.suggestions[0].account.id}`] : []))
          : rows.map((r) => r.business.id);
      return { ids, text: words("Lead Alchemist Companies") + (key === "linkCompanies" ? " (each to its top suggested account)" : "") };
    }
  }
}

/** Ticked rows for a button; Companies being linked carry the account chosen in their row. */
function rowValues(formData: FormData, key: string) {
  if (key !== "linkCompanies") return selected(formData, WORK[key].re);
  return selected(formData, LA_ID)
    .map((businessId) => `${businessId}:${String(formData.get(`match_${businessId}`) ?? "")}`)
    .filter((v) => PAIR.test(v));
}

async function bulk(formData: FormData, key: keyof typeof WORK): Promise<never> {
  const staff = await requireStaff();
  const { verb, options: optionNames, work } = WORK[key];
  const options = Object.fromEntries(optionNames.map((n) => [n, String(formData.get(n) ?? "")]));
  const actor = `staff:${staff.email}`;
  if (formData.get("allMatching") === "yes") {
    if (formData.get("confirmAll") !== "yes") return finish(formData, "error", "Tick the box to confirm running it on every matching row.");
    let started: number;
    try {
      const { ids, text } = await matchingIds(formData, key);
      started = (await startSelectionRun("mapping", { action: key, label: verb, options, ids, scopeText: text }, actor)).ids.length;
    } catch (err) {
      return finish(formData, "error", err instanceof Error ? err.message : String(err));
    }
    return finish(formData, "ok", `Started on all ${started.toLocaleString("en-US")} matching rows. Keep this page open; it continues on its own.`);
  }
  const ids = rowValues(formData, key);
  if (!ids.length) return finish(formData, "error", "Tick at least one row first.");
  let r: BulkResult;
  try {
    r = await work(ids, actor, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mapping] bulk action failed:", message);
    return finish(formData, "error", message);
  }
  const tab = new URL(backTo(formData), "http://x").searchParams.get("tab") ?? "accounts";
  const report = await saveSyncReport({ title: verb, scope: `${ids.length} ticked on Mapping → ${tab}`, page: backTo(formData), actor, total: ids.length, done: r.done, notes: r.notes });
  return finish(formData, report.clean ? "ok" : "warn", report.text, report.href);
}

/** One batch of a "select all matching" run; the progress panel submits this again until it's done. */
export async function stepMappingRunAction(formData: FormData) {
  await requireStaff();
  const run = await stepSelectionRun("mapping", (r) => {
    const w = WORK[r.action];
    return w ? (ids, actor) => w.work(ids, actor, r.options) : null;
  });
  if (run?.phase === "stopped" && run.error) console.error("[mapping] run stopped:", run.error);
  revalidatePath("/admin/mapping");
  redirect(backTo(formData));
}

export async function stopMappingRunAction(formData: FormData) {
  const staff = await requireStaff();
  await stopSelectionRun("mapping", `staff:${staff.email}`);
  return finish(formData, "ok", "Stopped. Rows already done stay done.");
}

async function sf() {
  const client = await salesforceClient();
  if (!client) throw new Error("Salesforce isn't connected. Add the keys in Settings → Integrations.");
  return client;
}

export async function searchMappingAction(formData: FormData) {
  await requireStaff();
  const q = formData.get("clear") ? "" : String(formData.get("q") ?? "").trim().slice(0, 100);
  const jar = await cookies();
  if (q) jar.set(MAP_SEARCH_COOKIE, q, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/admin/mapping", maxAge: 3600 });
  else jar.delete({ name: MAP_SEARCH_COOKIE, path: "/admin/mapping" });
  redirect(backTo(formData));
}

export async function accountsToLeadAlchemistAction(formData: FormData) {
  return bulk(formData, "accountsToLa");
}

export async function accountsToSalesforceAction(formData: FormData) {
  return bulk(formData, "accountsToSf");
}

export async function contactsToLeadAlchemistAction(formData: FormData) {
  return bulk(formData, "contactsToLa");
}

export async function contactsToCompanyAction(formData: FormData) {
  return bulk(formData, "contactsToCompany");
}

export async function contactsToSalesforceAction(formData: FormData) {
  return bulk(formData, "contactsToSf");
}

export async function companiesToSalesforceAction(formData: FormData) {
  return bulk(formData, "companiesToSf");
}

export async function companyTagsAction(formData: FormData) {
  return bulk(formData, "companyTags");
}

export async function linkCompaniesAction(formData: FormData) {
  return bulk(formData, "linkCompanies");
}

export async function addCompaniesToAppAction(formData: FormData) {
  return bulk(formData, "addCompanies");
}

/**
 * "Find Lead Alchemist matches": one time-boxed batch, then back to the page. While contacts are
 * left the page adds `matching=1`, which makes it submit this again on its own.
 */
export async function findLaMatchesAction(formData: FormData) {
  await requireStaff();
  if (!(await ghlConfig())) return finish(formData, "error", "Lead Alchemist isn't connected. Add the keys in Settings → Integrations.");
  if (formData.get("recheck") === "yes") await resetLaMatches();
  let done = false;
  try {
    done = (await findLaMatches({ timeBudgetMs: 40_000 })).done;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mapping] finding Lead Alchemist matches failed:", message);
    return finish(formData, "error", `Finding Lead Alchemist matches paused: ${message}. Press Continue to try again.`);
  }
  revalidatePath("/admin/mapping");
  const back = backTo(formData).replace(/([?&])(matching|f)=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  if (done) return finishTo(back, "ok", "Finished looking for Lead Alchemist matches.");
  redirect(`${back}${back.includes("?") ? "&" : "?"}matching=1`);
}
