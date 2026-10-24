"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { setFlash } from "@/lib/flash";
import { ghlConfig } from "@/lib/ghl/client";
import { links } from "@/lib/integrations/links";
import { findLaMatches, resetLaMatches } from "@/lib/mapping/la-matches";
import {
  addCompaniesToApp,
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

async function finish(formData: FormData, tone: "ok" | "error", text: string): Promise<never> {
  return finishTo(backTo(formData), tone, text);
}

async function finishTo(to: string, tone: "ok" | "error", text: string): Promise<never> {
  const back = to.replace(/([?&])f=[^&]*&?/, "$1").replace(/[?&]$/, "");
  const f = await setFlash({ tone, text });
  revalidatePath("/admin/mapping");
  redirect(`${back}${back.includes("?") ? "&" : "?"}f=${f}`);
}

const selected = (formData: FormData, re: RegExp) => formData.getAll("ids").map(String).filter((v) => re.test(v));

async function bulk(formData: FormData, re: RegExp, work: (ids: string[], actor: string) => Promise<BulkResult>, verb: string): Promise<never> {
  const staff = await requireStaff();
  const ids = selected(formData, re);
  if (!ids.length) return finish(formData, "error", "Tick at least one row first.");
  let r: BulkResult;
  try {
    r = await work(ids, `staff:${staff.email}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mapping] bulk action failed:", message);
    return finish(formData, "error", message);
  }
  return finish(formData, "ok", `${verb}: ${r.done} of ${ids.length}.${r.notes.length ? ` ${r.notes.join(" ")}` : ""}`);
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
  const createMissing = formData.get("createMissing") === "yes";
  return bulk(formData, UUID, async (ids, actor) => syncAccountsToLeadAlchemist(ids, actor, { sf: await salesforceClient(), links: await links() }, { createMissing }), "Synced to Lead Alchemist");
}

export async function accountsToSalesforceAction(formData: FormData) {
  return bulk(formData, UUID, async (ids, actor) => createAccountsInSalesforce(ids, actor, { sf: await sf(), links: await links() }), "Linked or created in Salesforce");
}

export async function contactsToLeadAlchemistAction(formData: FormData) {
  return bulk(formData, UUID, (ids, actor) => linkContactsToLeadAlchemist(ids, actor), "Linked to Lead Alchemist");
}

export async function contactsToCompanyAction(formData: FormData) {
  const createMissing = formData.get("createMissing") === "yes";
  return bulk(formData, UUID, (ids, actor) => connectSelectedContacts(ids, actor, { createMissing }), "Synced to Lead Alchemist");
}

export async function contactsToSalesforceAction(formData: FormData) {
  return bulk(formData, UUID, async (ids, actor) => createContactsInSalesforce(ids, actor, { sf: await sf(), links: await links() }), "Linked or created in Salesforce");
}

export async function companiesToSalesforceAction(formData: FormData) {
  return bulk(formData, LA_ID, async (ids, actor) => companiesToSalesforce(ids, actor, { sf: await sf(), links: await links() }), "Linked or created in Salesforce");
}

export async function companyTagsAction(formData: FormData) {
  return bulk(formData, UUID, (ids, actor) => pushCompanyTags(ids, actor), "Company tags added in Lead Alchemist");
}

/** Link each ticked Lead Alchemist Company to the Account chosen in its row (this app only). */
export async function linkCompaniesAction(formData: FormData) {
  return bulk(
    formData,
    LA_ID,
    (ids, actor) =>
      linkCompaniesToAccounts(
        ids.map((businessId) => ({ businessId, accountId: String(formData.get(`match_${businessId}`) ?? "") })).filter((p) => UUID.test(p.accountId)),
        actor,
      ),
    "Linked to accounts in this app",
  );
}

export async function addCompaniesToAppAction(formData: FormData) {
  return bulk(formData, LA_ID, (ids, actor) => addCompaniesToApp(ids, actor), "Added to this app");
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
