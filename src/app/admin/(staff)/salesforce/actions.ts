"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { saveSyncReport } from "@/lib/bulk/report";
import { getClient, getContact } from "@/lib/clients/repo";
import { laCompanyName } from "@/lib/clients/text";
import { setFlash } from "@/lib/flash";
import { ghlConfig, upsertContact } from "@/lib/ghl/client";
import { exactMatch, laCandidates, laName, linkLaContact, unlinkLaContact } from "@/lib/ghl/match";
import { links } from "@/lib/integrations/links";
import { resumeBulkSync, startBulkSync, stepBulkSync, stopBulkSync } from "@/lib/salesforce/bulk-sync";
import { salesforceClient } from "@/lib/salesforce/client";
import {
  deactivateAccount,
  reactivateAccount,
  relinkSalesforceAccount,
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
  return /^\/admin\/(salesforce|clients)(\/|\?|$)/.test(b) && !b.includes("//") ? b : "/admin/salesforce";
};

async function done(formData: FormData, tone: "ok" | "warn" | "error", text: string, href?: string): Promise<never> {
  const back = backTo(formData);
  const f = await setFlash({ tone, text, href });
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
  // Keep the Type filter; a new search starts from the first page.
  redirect(backTo(formData).replace(/([?&])offset=\d+&?/, "$1").replace(/[?&]$/, ""));
}

export async function syncAccountAction(formData: FormData) {
  return run(formData, async (actor) => (await syncAccount(id(formData, "sfAccountId"), { sf: await sf(), links: await links() }, actor)).result);
}

/**
 * "Sync selected": pull each ticked Salesforce Account into the app (up to 50 at a time; stops near
 * the time limit). Ends with a sync report: everything synced, or each conflict and error.
 */
export async function syncSelectedAccountsAction(formData: FormData) {
  const staff = await requireStaff();
  const actor = `staff:${staff.email}`;
  const ids = formData
    .getAll("ids")
    .map(String)
    .filter((v) => /^[A-Za-z0-9]{15,18}$/.test(v));
  if (!ids.length) return done(formData, "error", "Tick at least one Account first.");
  if (ids.length > 50) return done(formData, "error", "Sync up to 50 Accounts at a time, or use Select all matching.");
  let deps: { sf: Awaited<ReturnType<typeof sf>>; links: Awaited<ReturnType<typeof links>> };
  try {
    deps = { sf: await sf(), links: await links() };
  } catch (err) {
    return done(formData, "error", err instanceof Error ? err.message : String(err));
  }
  const started = Date.now();
  let synced = 0;
  let reached = 0;
  const notes: string[] = [];
  for (const sfId of ids) {
    if (Date.now() - started > 45_000) break;
    reached++;
    try {
      const r = await syncAccount(sfId, deps, actor);
      synced++;
      // A same-name Account already in AIS Connect: synced, but flagged as a possible duplicate.
      if (/same name/i.test(r.result)) notes.push(`${sfId}: ${r.result}`);
    } catch (err) {
      notes.push(`${sfId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (reached < ids.length) notes.unshift(`${ids.length - reached} weren't reached in time: tick them again.`);
  const report = await saveSyncReport({ title: "Synced into AIS Connect", scope: `${ids.length} ticked on Salesforce`, page: backTo(formData), actor, total: ids.length, done: synced, notes });
  return done(formData, report.clean ? "ok" : "warn", report.text, report.href);
}

/** "Select all N matching → Sync all": starts a run over every Account matching the search and Type. */
export async function startBulkSyncAction(formData: FormData) {
  return run(formData, async (actor) => {
    if (formData.get("confirm") !== "yes") throw new Error("Tick the box to confirm syncing every matching Account.");
    const q = (await cookies()).get(SF_SEARCH_COOKIE)?.value ?? "";
    const type = String(formData.get("type") ?? "").slice(0, 80);
    const r = await startBulkSync(await sf(), { q, type, writeLinks: formData.get("writeLinks") === "yes" }, actor);
    return `Started syncing ${r.total === null ? "every matching" : r.total.toLocaleString("en-US")} Account${r.total === 1 ? "" : "s"}. Keep this page open; it continues on its own.`;
  });
}

/** One batch of the run; the progress panel submits this again until it's done. */
export async function stepBulkSyncAction(formData: FormData) {
  await requireStaff();
  try {
    await stepBulkSync({ sf: await sf(), links: await links() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[salesforce screen] bulk sync step failed:", message);
    return done(formData, "error", `The sync paused on an error: ${message}. Press Continue to try again.`);
  }
  revalidatePath("/admin/salesforce");
  redirect(backTo(formData));
}

export async function stopBulkSyncAction(formData: FormData) {
  return run(formData, async (actor) => {
    await stopBulkSync(actor);
    return "Stopped. Accounts already synced stay synced.";
  });
}

export async function resumeBulkSyncAction(formData: FormData) {
  return run(formData, async () => {
    await resumeBulkSync();
    return "Resumed. Keep this page open; it continues on its own.";
  });
}

export async function unsyncAccountAction(formData: FormData) {
  return run(formData, async (actor) => {
    const c = await unsyncAccount(id(formData, "clientId"), actor);
    return `Stopped syncing "${c.name}". It's unchanged in Salesforce and stays in AIS Connect.`;
  });
}

export async function resumeAccountAction(formData: FormData) {
  return run(formData, async (actor) => `Syncing "${(await resumeAccount(id(formData, "clientId"), actor)).name}" again.`);
}

/** Deactivate an unsynced Account in this app (never deleted; reactivate any time). */
export async function deactivateAccountAction(formData: FormData) {
  return run(formData, async (actor) => {
    if (formData.get("confirm") !== "yes") throw new Error("Tick the box to confirm.");
    const c = await deactivateAccount(id(formData, "clientId"), actor, String(formData.get("reason") ?? ""));
    return `Deactivated "${c.name}" in AIS Connect. It's still in Salesforce, keeps its history, and can be reactivated.`;
  });
}

export async function reactivateAccountAction(formData: FormData) {
  return run(formData, async (actor) => `Reactivated "${(await reactivateAccount(id(formData, "clientId"), actor)).name}". Sync it again when you're ready.`);
}

/** Point an app Account at a different Salesforce Account; the old link stays in its activity. */
export async function relinkAccountAction(formData: FormData) {
  return run(formData, async (actor) => {
    const r = await relinkSalesforceAccount(id(formData, "clientId"), String(formData.get("sfAccount") ?? "").slice(0, 300), await sf(), actor);
    return `"${r.client.name}" is now linked to the Salesforce Account "${r.account.Name}". The previous link is in its activity.`;
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
    return `Removed ${c.name} from AIS Connect. They're still in Salesforce and Lead Alchemist; delete them there if they should go.`;
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
  return run(formData, async (actor) => `Unlinked ${(await unlinkLaContact(id(formData, "contactId"), actor)).name} in AIS Connect. Nothing changed in Lead Alchemist.`);
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
      companyName: account ? laCompanyName(account) : undefined,
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
