"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { CLIENT_SEARCH_COOKIE } from "@/lib/clients/search-cookie";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { addClientEvent, getClient, getContact, keepSeparate, listAccountContacts, listClientApplications, mergeClients, setPrimaryContact, splitContact } from "@/lib/clients/repo";
import { pushContactValue, refreshContactExternal, updateLeadAlchemistDetails } from "@/lib/contacts/external";
import { setFlash } from "@/lib/flash";
import { addNotificationNote } from "@/lib/notifications/repo";
import { salesforceClient } from "@/lib/salesforce/client";
import { refreshAccountFromSalesforce } from "@/lib/salesforce/refresh";
import { getApplication } from "@/lib/applications/repo";
import { syncNow } from "@/lib/salesforce/jobs";
import { defaultSyncDeps } from "@/lib/salesforce/sync";

// Every action re-checks the staff session: server actions are reachable by direct POST.

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const back = (clientId: string, params: Record<string, string>): never =>
  redirect(`/admin/clients/${clientId}?${new URLSearchParams(params).toString()}`);

/**
 * Results go on the application's and account's activity log (shown on return), not in the address:
 * they can name the client, and names, emails and phones never go in URLs.
 */

/** "Sync to Salesforce" on one application (retry). */
export async function syncApplicationAction(formData: FormData) {
  await requireStaff();
  const app = await getApplication(String(formData.get("id") ?? ""));
  if (!app) throw new Error("Application not found");
  const deps = await defaultSyncDeps();
  if ("off" in deps) redirect(`/admin/applications/${app.id}?sf=off`);
  const r = await syncNow(app.id);
  revalidatePath(`/admin/applications/${app.id}`);
  redirect(`/admin/applications/${app.id}?sf=${r.error ? "error" : "done"}`);
}

/** "Sync to Salesforce" on an Account: every submitted, non-test application, oldest first. */
export async function syncClientAction(formData: FormData) {
  await requireStaff();
  const client = await getClient(String(formData.get("id") ?? ""));
  if (!client) throw new Error("Account not found");
  const deps = await defaultSyncDeps();
  if ("off" in deps) back(client.id, { sf: "off" });
  const apps = (await listClientApplications(client.id)).filter((a) => !a.isTest).reverse();
  if (!apps.length) back(client.id, { sf: "none" });
  let failed = 0;
  for (const a of apps) if ((await syncNow(a.id)).error) failed++;
  revalidatePath(`/admin/clients/${client.id}`);
  back(client.id, { sf: failed ? "error" : "done" });
}

export async function mergeClientAction(formData: FormData) {
  const staff = await requireStaff();
  const targetId = String(formData.get("id") ?? "");
  // Staff paste the other account's page link or ID.
  const sourceId = String(formData.get("other") ?? "").match(UUID_RE)?.[0] ?? "";
  if (!sourceId) back(targetId, { error: "Paste the other account's page link (or its ID) to merge it in." });
  try {
    await mergeClients(targetId, sourceId, `staff:${staff.email}`);
  } catch (err) {
    back(targetId, { error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath("/admin/clients");
  back(targetId, { saved: "merged" });
}

/** "Possible duplicate": merge this new Account into the existing one it looks like. */
export async function mergeIntoDuplicateAction(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const client = await getClient(id);
  if (!client?.possibleDuplicateOf) back(id, { error: "This account isn't flagged as a possible duplicate." });
  let targetId = "";
  try {
    targetId = await mergeClients(client!.possibleDuplicateOf!, client!.id, `staff:${staff.email}`);
  } catch (err) {
    back(id, { error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath("/admin/clients");
  back(targetId, { saved: "merged" });
}

export async function keepSeparateAction(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  await keepSeparate(id, `staff:${staff.email}`);
  revalidatePath("/admin/clients");
  back(id, { saved: "separate" });
}

export async function splitContactAction(formData: FormData) {
  const staff = await requireStaff();
  const clientId = String(formData.get("id") ?? "");
  let newId = "";
  try {
    newId = await splitContact(clientId, String(formData.get("contactId") ?? ""), `staff:${staff.email}`);
  } catch (err) {
    back(clientId, { error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath("/admin/clients");
  back(newId, { saved: "split" });
}

export async function setPrimaryContactAction(formData: FormData) {
  await requireStaff();
  const clientId = String(formData.get("id") ?? "");
  try {
    await setPrimaryContact(clientId, String(formData.get("contactId") ?? ""));
  } catch (err) {
    back(clientId, { error: err instanceof Error ? err.message : String(err) });
  }
  back(clientId, { saved: "primary" });
}

export async function addClientNoteAction(formData: FormData) {
  const staff = await requireStaff();
  const client = await getClient(String(formData.get("id") ?? ""));
  const message = String(formData.get("message") ?? "").trim().slice(0, 4000);
  if (!client || !message) return;
  await addClientEvent(client.id, "staff_note", `staff:${staff.email}`, { message });
  revalidatePath(`/admin/clients/${client.id}`);
}

/**
 * The Accounts search box. The query (often an email or phone) is kept in a short-lived,
 * staff-only cookie instead of the address, so it never lands in URLs, history or logs.
 */
export async function searchClientsAction(formData: FormData) {
  await requireStaff();
  const q = formData.get("clear") ? "" : String(formData.get("q") ?? "").trim().slice(0, 100);
  const sort = String(formData.get("sort") ?? "latest").replace(/[^a-z]/g, "");
  const filter = String(formData.get("filter") ?? "all").replace(/[^a-z]/g, "");
  const jar = await cookies();
  if (q) jar.set(CLIENT_SEARCH_COOKIE, q, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/admin/clients", maxAge: 3600 });
  else jar.delete({ name: CLIENT_SEARCH_COOKIE, path: "/admin/clients" });
  redirect(`/admin/clients?sort=${sort}&filter=${filter}`);
}

/** "Refresh from Salesforce": read the linked Account and its contacts; nothing in the app is overwritten. */
export async function refreshFromSalesforceAction(formData: FormData) {
  const staff = await requireStaff();
  const client = await getClient(String(formData.get("id") ?? ""));
  if (!client) throw new Error("Account not found");
  const sf = await salesforceClient();
  if (!sf) back(client.id, { sf: "off" });
  let error: string | null = null;
  try {
    await refreshAccountFromSalesforce(client.id, sf!, `staff:${staff.email}`);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error("[accounts] refresh from Salesforce failed:", error);
  }
  revalidatePath(`/admin/clients/${client.id}`);
  back(client.id, error ? { error: error.slice(0, 200) } : { saved: "refreshed" });
}

/** Read the Lead Alchemist values only (no Salesforce link needed). */
export async function refreshContactsAction(formData: FormData) {
  await requireStaff();
  const client = await getClient(String(formData.get("id") ?? ""));
  if (!client) throw new Error("Account not found");
  for (const p of await listAccountContacts(client.id)) await refreshContactExternal(p.id).catch(() => {});
  revalidatePath(`/admin/clients/${client.id}`);
  back(client.id, { saved: "checked" });
}

/**
 * "Add Company to Lead Alchemist" (no contact needed: people can join the Company later), and
 * "Add to Lead Alchemist" on a contact (creates the Company first if needed, then the contact if
 * Lead Alchemist has no email or phone match, puts them in the Company and fills in their details).
 */
export async function addToLeadAlchemistAction(formData: FormData) {
  const staff = await requireStaff();
  const client = await getClient(String(formData.get("id") ?? ""));
  if (!client) throw new Error("Account not found");
  const contactId = String(formData.get("contactId") ?? "");
  const one = UUID_RE.test(contactId);
  let tone: "ok" | "error" = "ok";
  let text: string;
  try {
    const { syncAccountsToLeadAlchemist } = await import("@/lib/mapping/database");
    const { links } = await import("@/lib/integrations/links");
    const r = await syncAccountsToLeadAlchemist([client.id], `staff:${staff.email}`, { sf: await salesforceClient(), links: await links() }, one ? { createMissing: true, contactIds: [contactId] } : { companyOnly: true });
    const after = await getClient(client.id);
    text = [one ? "Added to Lead Alchemist." : after?.ghlCompanyId ? "The Company is in Lead Alchemist." : "No Company was added.", ...r.notes].join(" ");
    if (!after?.ghlCompanyId && !one) tone = "error";
  } catch (err) {
    tone = "error";
    text = err instanceof Error ? err.message : String(err);
  }
  const f = await setFlash({ tone, text });
  revalidatePath(`/admin/clients/${client.id}`);
  redirect(`/admin/clients/${client.id}?f=${f}`);
}

/**
 * "Link to an existing Company": a suggested Company or a pasted Lead Alchemist address / ID. The
 * account's contacts that are already linked to Lead Alchemist are put in it; nothing else changes.
 */
export async function linkAccountCompanyAction(formData: FormData) {
  const staff = await requireStaff();
  const actor = `staff:${staff.email}`;
  const client = await getClient(String(formData.get("id") ?? ""));
  if (!client) throw new Error("Account not found");
  const pasted = String(formData.get("business") ?? "").trim();
  const businessId = String(formData.get("businessId") ?? "").trim() || companyIdFrom(pasted);
  let tone: "ok" | "error" = "ok";
  let text: string;
  try {
    if (!businessId) throw new Error("Choose a Company or paste its Lead Alchemist address.");
    const { linkCompaniesToAccounts, syncAccountsToLeadAlchemist } = await import("@/lib/mapping/database");
    const { links } = await import("@/lib/integrations/links");
    const r = await linkCompaniesToAccounts([{ businessId, accountId: client.id }], actor);
    if (!r.done) throw new Error(r.notes.join(" ") || "That Company wasn't found in Lead Alchemist.");
    const linkedPeople = (await listAccountContacts(client.id)).filter((p) => p.ghlContactId && p.homeHere).map((p) => p.id);
    const s = linkedPeople.length
      ? await syncAccountsToLeadAlchemist([client.id], actor, { sf: await salesforceClient(), links: await links() }, { contactIds: linkedPeople })
      : { notes: [] as string[] };
    text = ["Linked to the Lead Alchemist Company.", ...s.notes].join(" ");
  } catch (err) {
    tone = "error";
    text = err instanceof Error ? err.message : String(err);
  }
  const f = await setFlash({ tone, text });
  revalidatePath(`/admin/clients/${client.id}`);
  redirect(`/admin/clients/${client.id}?f=${f}`);
}

/**
 * A contact not in Lead Alchemist yet, on the account page:
 * - check: look Lead Alchemist up by email and phone and show the suggestion (nothing is linked);
 * - link: use the suggested contact (put in the Company, empty fields filled, links written);
 * - deny: it's someone else: never suggest it again, and create a new Lead Alchemist contact;
 * - create: no match: create the contact (and the Company if needed).
 */
export async function laContactAction(formData: FormData) {
  const staff = await requireStaff();
  const actor = `staff:${staff.email}`;
  const contactId = String(formData.get("contactId") ?? "");
  const op = String(formData.get("op") ?? "");
  if (!UUID_RE.test(contactId)) throw new Error("Unknown contact");
  const contact = await getContact(contactId);
  if (!contact) throw new Error("That contact no longer exists.");
  const { checkLaMatch, denyLaMatch } = await import("@/lib/mapping/la-matches");
  const { syncAccountsToLeadAlchemist } = await import("@/lib/mapping/database");
  const { linkLaContact } = await import("@/lib/ghl/match");
  const { links } = await import("@/lib/integrations/links");
  const deps = { sf: await salesforceClient(), links: await links() };
  const sync = (createMissing: boolean) => syncAccountsToLeadAlchemist([contact.clientId], actor, deps, { createMissing, contactIds: [contact.id] });
  let tone: "ok" | "error" = "ok";
  let text = "";
  try {
    if (op === "check") {
      const m = await checkLaMatch(contact.id);
      text = m.id
        ? `${contact.name}: Lead Alchemist has a contact with the same ${m.how?.replace("+", " and ")} (${m.name}). Check it, then use it or create a new one.`
        : m.how === "several"
          ? `${contact.name}: several Lead Alchemist contacts have this email or phone. Open the Salesforce Account page to pick one, or create a new one.`
          : `${contact.name}: no Lead Alchemist contact has this email or phone. You can create one.`;
    } else if (op === "link") {
      if (!contact.laMatchId) throw new Error("There's no suggestion to use: check Lead Alchemist again.");
      await linkLaContact(contact.id, contact.laMatchId, actor);
      const r = await sync(false);
      text = [`${contact.name} linked to their Lead Alchemist contact and put in the Company.`, ...r.notes].join(" ");
    } else if (op === "deny") {
      await denyLaMatch(contact.id);
      const r = await sync(true);
      const after = await getContact(contact.id);
      text = after?.ghlContactId
        ? [`${contact.name}: suggestion rejected; a new Lead Alchemist contact was created and put in the Company.`, ...r.notes].join(" ")
        : [`${contact.name}: suggestion rejected (it won't be suggested again), but Lead Alchemist didn't create a new contact.`, ...r.notes].join(" ");
      if (!after?.ghlContactId) tone = "error";
    } else if (op === "create") {
      const r = await sync(true);
      const after = await getContact(contact.id);
      text = after?.ghlContactId ? [`${contact.name} is in Lead Alchemist and in the Company.`, ...r.notes].join(" ") : [`${contact.name} wasn't added.`, ...r.notes].join(" ");
      if (!after?.ghlContactId) tone = "error";
    } else throw new Error("Unknown action");
  } catch (err) {
    tone = "error";
    text = err instanceof Error ? err.message : String(err);
  }
  const f = await setFlash({ tone, text });
  revalidatePath(`/admin/clients/${contact.clientId}`);
  redirect(`/admin/clients/${contact.clientId}?f=${f}`);
}

/**
 * "Update in Lead Alchemist": fill the contact's empty Lead Alchemist fields from the app (or, with
 * replace, every field that differs) and write the links between the three systems onto it.
 */
export async function updateLaContactAction(formData: FormData) {
  const staff = await requireStaff();
  const contactId = String(formData.get("contactId") ?? "");
  if (!UUID_RE.test(contactId)) throw new Error("Unknown contact");
  const contact = await getContact(contactId);
  if (!contact) throw new Error("That contact no longer exists.");
  let text: string;
  let tone: "ok" | "error" = "ok";
  try {
    const { fields } = await updateLeadAlchemistDetails(contactId, `staff:${staff.email}`, { replace: formData.get("replace") === "yes" });
    text = fields.length ? `${contact.name}: updated ${fields.join(", ")} in Lead Alchemist (and the links between the three systems).` : `${contact.name}: Lead Alchemist already matches; links refreshed.`;
  } catch (err) {
    tone = "error";
    text = err instanceof Error ? err.message : String(err);
  }
  const f = await setFlash({ tone, text });
  revalidatePath(`/admin/clients/${contact.clientId}`);
  redirect(`/admin/clients/${contact.clientId}?f=${f}`);
}

/**
 * Send the application's phone or email to Salesforce or Lead Alchemist (on demand only). From the
 * account page or a notification; the notification's log records who sent what.
 */
export async function pushContactValueAction(formData: FormData) {
  const staff = await requireStaff();
  const actor = `staff:${staff.email}`;
  const contactId = String(formData.get("contactId") ?? "");
  const target = String(formData.get("target") ?? "");
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "");
  const notificationId = String(formData.get("notificationId") ?? "");
  const backTo = String(formData.get("back") ?? "");
  if (!UUID_RE.test(contactId) || (target !== "salesforce" && target !== "lead_alchemist") || (field !== "phone" && field !== "email")) {
    throw new Error("Unknown contact or field");
  }
  let error: string | null = null;
  let clientId = "";
  try {
    const { contact, where } = await pushContactValue(contactId, target, field, value, actor);
    clientId = contact.clientId;
    if (UUID_RE.test(notificationId)) await addNotificationNote(notificationId, actor, `Sent the ${field} ${value} to ${where}`, "pushed");
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  revalidatePath("/admin/notifications");
  if (backTo.startsWith("/admin/notifications/") && UUID_RE.test(backTo)) {
    const f = await setFlash(error ? { tone: "error", text: error } : { tone: "ok", text: `Sent the ${field} to ${target === "salesforce" ? "Salesforce" : "Lead Alchemist"}.` });
    redirect(`${backTo.split("?")[0]}?f=${f}`);
  }
  if (clientId) revalidatePath(`/admin/clients/${clientId}`);
  const contact = clientId ? null : await getContact(contactId);
  back(clientId || contact?.clientId || "", error ? { error: error.slice(0, 200) } : { saved: "pushed" });
}

/** A Company ID from a pasted Lead Alchemist address (its last path segment) or the bare ID. */
function companyIdFrom(pasted: string) {
  const id = /^https?:\/\//i.test(pasted) ? (URL.canParse(pasted) ? new URL(pasted).pathname.split("/").filter(Boolean).pop() ?? "" : "") : pasted;
  return /^[A-Za-z0-9]{6,64}$/.test(id) ? id : "";
}
