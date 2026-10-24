import "server-only";
import { and, count, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Client, Contact } from "@/lib/db/schema";
import {
  addClientEvent,
  ensureContact,
  getClient,
  getContact,
  getContactByEmail,
  getContactBySalesforceId,
  refreshSearch,
  setClientSalesforce,
} from "@/lib/clients/repo";
import { accountDetail, applyAccount, proposeForAccount, type AccountRow, type SalesforceImportDeps } from "@/lib/mapping/salesforce-import";
import { soqlString, type SalesforceApi } from "./api";
import { accountSelect, CONTACT_FIELDS, contactsReadable, selectList, visibleFields } from "./fields";
import { hiddenSet, hide, unhide } from "./hidden";

/**
 * The Salesforce screen: browse Salesforce Accounts and their Contacts, and choose what this
 * app keeps in sync. Nothing here deletes anything in Salesforce or Lead Alchemist:
 * - Sync pulls the record into the app (link or create) and keeps it in the automatic sync.
 * - Unsync keeps the record and its links, but stops syncing it either way.
 * - Remove deletes the copy in this app only, and keeps it out of later imports. It's blocked
 *   while applications point at it (unsync instead). Deleting the record itself is done in
 *   Salesforce or Lead Alchemist; the screen links there.
 */

export type AppState = "not_in_app" | "synced" | "unsynced" | "removed" | "deactivated";

export interface SfAccountListRow {
  id: string;
  name: string;
  /** Salesforce Account Type: the account's status. */
  type: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  /** null when the integration user can't read Contacts. */
  contacts: number | null;
  appState: AppState;
  client?: { id: string; name: string };
}

/** Rows per page on the Salesforce screen. */
export const PAGE_SIZES = [25, 50, 100, 200] as const;
/** SOQL OFFSET stops at 2,000; past that, search narrows the list. */
export const MAX_OFFSET = 2000;

const likeTerm = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/** One page of Salesforce Accounts, each with where it stands in this app. */
/** The Account Type picklist values (Customer, Prospect…), for the Type filter. Empty when Type isn't readable. */
export async function accountTypes(sf: SalesforceApi): Promise<string[]> {
  const field = (await sf.describe("Account")).fields.find((f) => f.name === "Type");
  return (field?.picklistValues ?? []).filter((p) => p.active).map((p) => p.value);
}

/** NO_TYPE filters Accounts whose Type is blank. */
export const NO_TYPE = "__none__";

export async function listSalesforceAccounts(sf: SalesforceApi, opts: { q?: string; offset?: number; type?: string | null; pageSize?: number } = {}) {
  const PAGE_SIZE = PAGE_SIZES.includes(opts.pageSize as (typeof PAGE_SIZES)[number]) ? opts.pageSize! : 50;
  const q = opts.q?.trim();
  const offset = Math.min(Math.max(0, opts.offset ?? 0), MAX_OFFSET);
  const wanted = ["Name", "Type", "Phone", "Website", "BillingCity", "BillingState"];
  const [visible, contactsVisible] = await Promise.all([visibleFields(sf, "Account", wanted), contactsReadable(sf)]);
  const conditions = [
    q ? `Name LIKE ${soqlString(`%${likeTerm(q)}%`)}` : null,
    opts.type && visible.includes("Type") ? (opts.type === NO_TYPE ? "Type = null" : `Type = ${soqlString(opts.type)}`) : null,
  ].filter(Boolean);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")} ` : "";
  // How many match in all ("SELECT COUNT()" returns only totalSize).
  const totalPromise = sf
    .queryPage(`SELECT COUNT() FROM Account ${where}`)
    .then((r) => r.totalSize ?? null)
    .catch(() => null);
  const { records } = await sf.queryPage<AccountRow & { Contacts?: { totalSize?: number; records: unknown[] } | null }>(
    `SELECT ${["Id", ...visible].join(", ")}${contactsVisible ? ", (SELECT Id FROM Contacts)" : ""} ` +
      `FROM Account ${where}ORDER BY Name, Id LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
  );
  const page = records.slice(0, PAGE_SIZE);
  const ids = page.map((r) => r.Id);
  const db = await getDb();
  const linked = ids.length
    ? await db
        .select({
          id: schema.clients.id,
          name: schema.clients.name,
          sfAccountId: schema.clients.sfAccountId,
          paused: schema.clients.sfSyncPaused,
          deactivated: schema.clients.deactivatedAt,
        })
        .from(schema.clients)
        .where(and(inArray(schema.clients.sfAccountId, ids), isNull(schema.clients.mergedInto)))
    : [];
  const hidden = await hiddenSet(ids);
  const rows: SfAccountListRow[] = page.map((r) => {
    const c = linked.find((l) => l.sfAccountId === r.Id);
    return {
      id: r.Id,
      name: r.Name,
      type: r.Type ?? null,
      phone: r.Phone,
      website: r.Website,
      city: r.BillingCity,
      state: r.BillingState,
      contacts: contactsVisible ? (r.Contacts?.totalSize ?? r.Contacts?.records.length ?? 0) : null,
      appState: c ? (c.deactivated ? "deactivated" : c.paused ? "unsynced" : "synced") : hidden.has(r.Id) ? "removed" : "not_in_app",
      client: c ? { id: c.id, name: c.name } : undefined,
    };
  });
  return {
    rows,
    total: await totalPromise,
    hasMore: records.length > PAGE_SIZE && offset + PAGE_SIZE <= MAX_OFFSET,
    offset,
    pageSize: PAGE_SIZE,
    /** What the integration user can't read, so the page can say why columns are empty. */
    contactsVisible,
    hiddenFields: wanted.filter((f) => !visible.includes(f)),
  };
}

/** Counts for the top of the screen, from the app's side. */
export async function appSalesforceCounts() {
  const db = await getDb();
  const [synced] = await db
    .select({ n: count() })
    .from(schema.clients)
    .where(and(isNull(schema.clients.mergedInto), isNull(schema.clients.deactivatedAt), eq(schema.clients.sfSyncPaused, false), isNotNull(schema.clients.sfAccountId)));
  const [unsynced] = await db
    .select({ n: count() })
    .from(schema.clients)
    .where(and(isNull(schema.clients.mergedInto), isNull(schema.clients.deactivatedAt), eq(schema.clients.sfSyncPaused, true)));
  const [deactivated] = await db.select({ n: count() }).from(schema.clients).where(and(isNull(schema.clients.mergedInto), isNotNull(schema.clients.deactivatedAt)));
  return { synced: synced.n, unsynced: unsynced.n, deactivated: deactivated.n };
}

async function fetchAccount(sf: SalesforceApi, sfAccountId: string): Promise<AccountRow> {
  const [account] = await sf.query<AccountRow>(`${await accountSelect(sf)} WHERE Id = ${soqlString(sfAccountId)} LIMIT 1`);
  if (!account) throw new Error("That Salesforce Account wasn't found (it may have been deleted in Salesforce).");
  return account;
}

/**
 * Sync: pull the Salesforce Account (and its Contacts) into the app and keep it syncing.
 * Links to the app Account it matches (already linked, a Contact's email, or same name and
 * phone/website); otherwise creates one, flagged as a possible duplicate when only the name matches.
 */
export async function syncAccount(sfAccountId: string, deps: SalesforceImportDeps, actor: string, prefetched?: AccountRow) {
  const account = prefetched ?? (await fetchAccount(deps.sf, sfAccountId));
  await unhide([sfAccountId]);
  const proposal = await proposeForAccount(account);
  const row = { sourceId: account.Id, sourceName: account.Name, sourceDetail: accountDetail(account) };
  const linkTo = proposal.proposal === "link" ? (proposal.targetId ?? null) : null;
  const { account: client, result } = await applyAccount(row, linkTo ? "link" : "create", linkTo, deps, actor, {
    possibleDuplicateOf: proposal.confidence === "name_only" ? (proposal.candidates?.[0]?.id ?? null) : null,
  });
  await setClientSalesforce(client.id, { sfSyncPaused: false, sfPulledAt: new Date() });
  return { clientId: client.id, result: proposal.confidence === "name_only" ? `${result}. Another Account has the same name: check it on Accounts.` : result };
}

/** Unsync: keep the Account and its links, stop syncing it either way. */
export async function unsyncAccount(clientId: string, actor: string) {
  const client = await getClient(clientId);
  if (!client) throw new Error("That Account no longer exists.");
  await setClientSalesforce(client.id, { sfSyncPaused: true });
  await addClientEvent(client.id, "sf_sync_paused", actor, { message: "Salesforce sync turned off for this Account (nothing was changed in Salesforce)" });
  return client;
}

/** Turn syncing back on for an Account that's still linked. */
export async function resumeAccount(clientId: string, actor: string) {
  const client = await getClient(clientId);
  if (!client) throw new Error("That Account no longer exists.");
  await setClientSalesforce(client.id, { sfSyncPaused: false });
  await addClientEvent(client.id, "sf_sync_resumed", actor, { message: "Salesforce sync turned back on for this Account" });
  return client;
}

/** What keeps a record from being removed from the dashboard: applications or drafts that point at it. */
export async function accountBlockers(clientId: string) {
  const db = await getDb();
  const contactIds = (await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.clientId, clientId))).map((c) => c.id);
  const appWhere = contactIds.length
    ? or(eq(schema.applications.clientId, clientId), inArray(schema.applications.contactId, contactIds))
    : eq(schema.applications.clientId, clientId);
  const draftWhere = contactIds.length ? or(eq(schema.drafts.clientId, clientId), inArray(schema.drafts.contactId, contactIds)) : eq(schema.drafts.clientId, clientId);
  const [[apps], [drafts]] = await Promise.all([
    db.select({ n: count() }).from(schema.applications).where(appWhere),
    db.select({ n: count() }).from(schema.drafts).where(draftWhere),
  ]);
  return { applications: apps.n, drafts: drafts.n };
}

/**
 * Deactivate: hide the Account in this app (it's never deleted, here or in Salesforce). It must be
 * unsynced first. It keeps its Salesforce link, contacts, applications and activity, stays out of
 * imports and bulk syncs, and can be reactivated at any time.
 */
export async function deactivateAccount(clientId: string, actor: string, reason?: string | null) {
  const client = await getClient(clientId);
  if (!client) throw new Error("That Account no longer exists.");
  if (client.deactivatedAt) return client;
  if (client.sfAccountId && !client.sfSyncPaused) throw new Error(`Unsync "${client.name}" first, then deactivate it.`);
  const db = await getDb();
  await db.update(schema.clients).set({ deactivatedAt: new Date(), deactivatedBy: actor, updatedAt: new Date() }).where(eq(schema.clients.id, client.id));
  await addClientEvent(client.id, "deactivated", actor, {
    message: `Deactivated in this app${client.sfAccountId ? ` (was synced with Salesforce Account ${client.sfAccountId}; nothing changed in Salesforce)` : ""}${reason?.trim() ? `. Reason: ${reason.trim().slice(0, 300)}` : ""}`,
    data: { sfAccountId: client.sfAccountId },
  });
  return client;
}

/** Reactivate: show the Account again. It stays unsynced until someone syncs it. */
export async function reactivateAccount(clientId: string, actor: string) {
  const client = await getClient(clientId);
  if (!client) throw new Error("That Account no longer exists.");
  if (!client.deactivatedAt) return client;
  const db = await getDb();
  await db.update(schema.clients).set({ deactivatedAt: null, deactivatedBy: null, updatedAt: new Date() }).where(eq(schema.clients.id, client.id));
  await addClientEvent(client.id, "reactivated", actor, {
    message: `Reactivated${client.sfAccountId ? `; still linked to Salesforce Account ${client.sfAccountId} (unsynced until synced again)` : ""}`,
  });
  return client;
}

/**
 * Point the app Account at a different Salesforce Account (e.g. the client moved, or it was linked
 * to the wrong one). Reads Salesforce only. The old link is kept in the activity log.
 */
export async function relinkSalesforceAccount(clientId: string, newSfAccountId: string, sf: SalesforceApi, actor: string) {
  const client = await getClient(clientId);
  if (!client) throw new Error("That Account no longer exists.");
  const target = newSfAccountId.match(/\b(001[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?)\b/)?.[1];
  if (!target) throw new Error("Paste the Salesforce Account's ID or its address (it starts with 001).");
  if (target === client.sfAccountId) throw new Error("It's already linked to that Salesforce Account.");
  const [row] = await sf.query<{ Id: string; Name: string }>(`SELECT Id, Name FROM Account WHERE Id = ${soqlString(target)} LIMIT 1`);
  if (!row) throw new Error("That Salesforce Account wasn't found.");
  const db = await getDb();
  const [other] = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(and(eq(schema.clients.sfAccountId, row.Id), isNull(schema.clients.mergedInto)))
    .limit(1);
  if (other && other.id !== client.id) throw new Error(`"${other.name}" in this app is already linked to that Salesforce Account. Merge the two accounts instead.`);
  const previous = client.sfAccountId;
  await setClientSalesforce(client.id, { sfAccountId: row.Id, sfStatus: "linked", sfLastError: null, sfSyncPaused: false });
  await db.update(schema.clients).set({ sfSnapshot: null, sfAccountType: null }).where(eq(schema.clients.id, client.id));
  await unhide([row.Id]);
  await addClientEvent(client.id, "sf_relinked", actor, {
    message: `Linked to Salesforce Account "${row.Name}" (${row.Id})${previous ? `, instead of ${previous}` : ""}. Use Refresh from Salesforce to read it.`,
    data: { from: previous, to: row.Id },
  });
  return { client, account: row, previous };
}

// ── Contacts ──────────────────────────────────────────────────────────

type SfContactRow = { Id: string; Email: string | null; FirstName: string | null; LastName: string | null; Phone: string | null; Title: string | null; AccountId: string | null };

export interface SfContactListRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  appState: AppState;
  contact?: Contact;
}

/** The Salesforce Account and its Contacts, each with where it stands in this app. */
export async function salesforceAccountDetail(sf: SalesforceApi, sfAccountId: string) {
  const account = await fetchAccount(sf, sfAccountId);
  const db = await getDb();
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.sfAccountId, sfAccountId), isNull(schema.clients.mergedInto)))
    .limit(1);
  const records = account.Contacts?.records ?? [];
  const hidden = await hiddenSet([sfAccountId, ...records.map((c) => c.Id)]);
  const contacts: SfContactListRow[] = [];
  for (const c of records) {
    const mine = (await getContactBySalesforceId(c.Id)) ?? (c.Email ? await getContactByEmail(c.Email) : undefined);
    contacts.push({
      id: c.Id,
      name: [c.FirstName, c.LastName].filter(Boolean).join(" ") || c.Email || "Unnamed",
      email: c.Email,
      phone: c.Phone,
      title: c.Title,
      appState: mine ? (mine.sfSyncPaused ? "unsynced" : "synced") : hidden.has(c.Id) ? "removed" : "not_in_app",
      contact: mine,
    });
  }
  const accountState: AppState = client
    ? client.deactivatedAt
      ? "deactivated"
      : client.sfSyncPaused
        ? "unsynced"
        : "synced"
    : hidden.has(sfAccountId)
      ? "removed"
      : "not_in_app";
  return { account, client: client as Client | undefined, accountState, contacts };
}

/** Sync one Salesforce Contact into its Account in the app (the Account must be in the app). */
export async function syncContact(sf: SalesforceApi, sfContactId: string, actor: string) {
  const [c] = await sf.query<SfContactRow>(
    `SELECT ${await selectList(sf, "Contact", [...CONTACT_FIELDS, "AccountId"])} FROM Contact WHERE Id = ${soqlString(sfContactId)} LIMIT 1`,
  );
  if (!c) throw new Error("That Salesforce Contact wasn't found (it may have been deleted in Salesforce).");
  const db = await getDb();
  const [client] = c.AccountId
    ? await db
        .select()
        .from(schema.clients)
        .where(and(eq(schema.clients.sfAccountId, c.AccountId), isNull(schema.clients.mergedInto)))
        .limit(1)
    : [];
  if (!client) throw new Error("Sync the Contact's Account first.");
  await unhide([c.Id]);
  const before = (await getContactBySalesforceId(c.Id)) ?? (c.Email ? await getContactByEmail(c.Email) : undefined);
  const contact = await ensureContact({
    clientId: client.id,
    email: c.Email,
    firstName: c.FirstName,
    lastName: c.LastName,
    title: c.Title,
    phone: c.Phone,
    sfContactId: c.Id,
  });
  await db.update(schema.contacts).set({ sfSyncPaused: false, ...(contact.sfContactId ? {} : { sfContactId: c.Id }) }).where(eq(schema.contacts.id, contact.id));
  await refreshSearch(client.id);
  if (before?.sfSyncPaused) await addClientEvent(client.id, "sf_sync_resumed", actor, { message: `Salesforce sync turned back on for ${contact.name}` });
  return { contact, clientId: client.id, created: !before };
}

export async function unsyncContact(contactId: string, actor: string) {
  const contact = await getContact(contactId);
  if (!contact) throw new Error("That contact no longer exists.");
  const db = await getDb();
  await db.update(schema.contacts).set({ sfSyncPaused: true, updatedAt: new Date() }).where(eq(schema.contacts.id, contact.id));
  await addClientEvent(contact.clientId, "sf_sync_paused", actor, { message: `Salesforce sync turned off for ${contact.name} (nothing was changed in Salesforce)` });
  return contact;
}

export async function contactBlockers(contactId: string) {
  const db = await getDb();
  const [[apps], [drafts]] = await Promise.all([
    db.select({ n: count() }).from(schema.applications).where(eq(schema.applications.contactId, contactId)),
    db.select({ n: count() }).from(schema.drafts).where(eq(schema.drafts.contactId, contactId)),
  ]);
  return { applications: apps.n, drafts: drafts.n };
}

/** Remove a contact from this app only (blocked while applications or drafts name them). */
export async function removeContactFromDashboard(contactId: string, actor: string) {
  const contact = await getContact(contactId);
  if (!contact) throw new Error("That contact no longer exists.");
  const b = await contactBlockers(contact.id);
  if (b.applications || b.drafts) {
    throw new Error(`${contact.name} filled out ${b.applications} application${b.applications === 1 ? "" : "s"}${b.drafts ? ` and has ${b.drafts} draft${b.drafts === 1 ? "" : "s"}` : ""}, so they can't be removed. Unsync them instead.`);
  }
  const db = await getDb();
  if (contact.sfContactId) await hide(contact.sfContactId, "contact", contact.name, actor);
  await db.delete(schema.contacts).where(eq(schema.contacts.id, contact.id));
  await refreshSearch(contact.clientId);
  await addClientEvent(contact.clientId, "contact_removed", actor, {
    message: `${contact.name} removed from this app (still in Salesforce and Lead Alchemist)`,
  });
  return contact;
}
