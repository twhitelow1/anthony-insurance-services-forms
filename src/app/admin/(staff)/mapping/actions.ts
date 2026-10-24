"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { setFlash } from "@/lib/flash";
import { links } from "@/lib/integrations/links";
import {
  companiesToSalesforce,
  connectSelectedContacts,
  createAccountsInSalesforce,
  createContactsInSalesforce,
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
  const back = backTo(formData).replace(/([?&])f=[^&]*&?/, "$1").replace(/[?&]$/, "");
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
