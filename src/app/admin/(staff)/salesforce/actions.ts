"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { getClient, getContact } from "@/lib/clients/repo";
import { setFlash } from "@/lib/flash";
import { ghlConfig, upsertContact } from "@/lib/ghl/client";
import { exactMatch, laCandidates, laName, linkLaContact, unlinkLaContact } from "@/lib/ghl/match";
import { links } from "@/lib/integrations/links";
import { salesforceClient } from "@/lib/salesforce/client";
import {
  removeAccountFromDashboard,
  removeContactFromDashboard,
  resumeAccount,
  syncAccount,
  syncContact,
  unsyncAccount,
  unsyncContact,
} from "@/lib/salesforce/manager";
import { SF_SEARCH_COOKIE } from "./search-cookie";

// Every action re-checks the staff session: server actions are reachable by direct POST.
// None of these delete anything in Salesforce or Lead Alchemist (see lib/salesforce/manager.ts).

const backTo = (formData: FormData) => {
  const b = String(formData.get("back") ?? "");
  return b.startsWith("/admin/salesforce") && !b.includes("//") ? b : "/admin/salesforce";
};

async function done(formData: FormData, tone: "ok" | "error", text: string): Promise<never> {
  const back = backTo(formData);
  const f = await setFlash({ tone, text });
  revalidatePath("/admin/salesforce");
  redirect(`${back}${back.includes("?") ? "&" : "?"}f=${f}`);
}

async function run(formData: FormData, work: (actor: string) => Promise<string>): Promise<never> {
  const staff = await requireStaff();
  const actor = `staff:${staff.email}`;
  let text: string;
  try {
    text = await work(actor);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[salesforce screen] action failed:", message);
    return done(formData, "error", message);
  }
  return done(formData, "ok", text);
}

const id = (formData: FormData, key: string) => {
  const v = String(formData.get(key) ?? "").trim();
  if (!/^[A-Za-z0-9-]{1,40}$/.test(v)) throw new Error("Missing record");
  return v;
};

async function sf() {
  const client = await salesforceClient();
  if (!client) throw new Error("Salesforce isn't connected. Add the keys in Settings → Integrations.");
  return client;
}

export async function searchSalesforceAction(formData: FormData) {
  await requireStaff();
  const q = formData.get("clear") ? "" : String(formData.get("q") ?? "").trim().slice(0, 80);
  const jar = await cookies();
  if (q) jar.set(SF_SEARCH_COOKIE, q, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/admin/salesforce", maxAge: 3600 });
  else jar.delete({ name: SF_SEARCH_COOKIE, path: "/admin/salesforce" });
  redirect("/admin/salesforce");
}

export async function syncAccountAction(formData: FormData) {
  return run(formData, async (actor) => (await syncAccount(id(formData, "sfAccountId"), { sf: await sf(), links: await links() }, actor)).result);
}

export async function unsyncAccountAction(formData: FormData) {
  return run(formData, async (actor) => {
    const c = await unsyncAccount(id(formData, "clientId"), actor);
    return `Stopped syncing "${c.name}". It's unchanged in Salesforce and stays in this app.`;
  });
}

export async function resumeAccountAction(formData: FormData) {
  return run(formData, async (actor) => `Syncing "${(await resumeAccount(id(formData, "clientId"), actor)).name}" again.`);
}

export async function removeAccountAction(formData: FormData) {
  return run(formData, async (actor) => {
    if (formData.get("confirm") !== "yes") throw new Error("Tick the box to confirm.");
    const c = await removeAccountFromDashboard(id(formData, "clientId"), actor);
    return `Removed "${c.name}" from this app. It's still in Salesforce${c.ghlCompanyId ? " and Lead Alchemist" : ""}; delete it there if it should go.`;
  });
}

export async function syncContactAction(formData: FormData) {
  return run(formData, async (actor) => {
    const r = await syncContact(await sf(), id(formData, "sfContactId"), actor);
    return `${r.created ? "Added" : "Synced"} ${r.contact.name}.`;
  });
}

export async function unsyncContactAction(formData: FormData) {
  return run(formData, async (actor) => `Stopped syncing ${(await unsyncContact(id(formData, "contactId"), actor)).name}. Nothing changed in Salesforce.`);
}

export async function removeContactAction(formData: FormData) {
  return run(formData, async (actor) => {
    if (formData.get("confirm") !== "yes") throw new Error("Tick the box to confirm.");
    const c = await removeContactFromDashboard(id(formData, "contactId"), actor);
    return `Removed ${c.name} from this app. They're still in Salesforce and Lead Alchemist; delete them there if they should go.`;
  });
}

// ── Lead Alchemist contact links (saved in this app; Lead Alchemist records aren't changed) ──

export async function linkLaContactAction(formData: FormData) {
  return run(formData, async (actor) => {
    const { contact, la } = await linkLaContact(id(formData, "contactId"), id(formData, "ghlContactId"), actor);
    return `Linked ${contact.name} to the Lead Alchemist contact ${laName(la)}.`;
  });
}

export async function unlinkLaContactAction(formData: FormData) {
  return run(formData, async (actor) => `Unlinked ${(await unlinkLaContact(id(formData, "contactId"), actor)).name} in this app. Nothing changed in Lead Alchemist.`);
}

/** Create the Lead Alchemist contact when none was found by email or phone, then link it. */
export async function createLaContactAction(formData: FormData) {
  return run(formData, async (actor) => {
    if (!(await ghlConfig())) throw new Error("Lead Alchemist isn't connected. Add the keys in Settings → Integrations.");
    const contact = await getContact(id(formData, "contactId"));
    if (!contact) throw new Error("That contact no longer exists.");
    const [existing] = await laCandidates(contact, { byName: false });
    if (existing) throw new Error(`Lead Alchemist already has a contact with this email or phone (${laName(existing.contact)}). Link that one instead.`);
    const account = await getClient(contact.clientId);
    const res = await upsertContact({
      email: contact.primaryEmail ?? undefined,
      firstName: contact.firstName ?? (contact.lastName ? undefined : contact.name),
      lastName: contact.lastName ?? undefined,
      phone: contact.phones[0],
      companyName: account && !account.isIndividual ? account.name : undefined,
      source: "Online Applications App",
    });
    await linkLaContact(contact.id, res.contact.id, actor);
    return `Created ${contact.name} in Lead Alchemist and linked them.`;
  });
}

/** Link every contact on the Account that has exactly one email or phone match. */
export async function linkExactLaMatchesAction(formData: FormData) {
  return run(formData, async (actor) => {
    if (!(await ghlConfig())) throw new Error("Lead Alchemist isn't connected. Add the keys in Settings → Integrations.");
    const ids = String(formData.get("contactIds") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 100);
    let linked = 0;
    let unclear = 0;
    for (const contactId of ids) {
      const contact = await getContact(contactId);
      if (!contact || contact.ghlContactId) continue;
      const match = exactMatch(await laCandidates(contact, { byName: false }));
      if (match) {
        await linkLaContact(contact.id, match.id, actor);
        linked++;
      } else unclear++;
    }
    return `Linked ${linked} contact${linked === 1 ? "" : "s"} by email or phone.${unclear ? ` ${unclear} had no single match: pick them by hand.` : ""}`;
  });
}
