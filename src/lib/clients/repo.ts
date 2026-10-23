import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Client, ClientAddress, ClientEventType, SalesforceStatus } from "@/lib/db/schema";
import type { ApplicationStatus } from "@/lib/applications/status";
import { clientSearchText, phoneDigits, searchTerms } from "./text";

const { clients, clientEmails, clientEvents, applications, drafts, applicants } = schema;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export interface ClientDetails {
  email: string;
  /** The person's name. */
  contactName?: string | null;
  businessName?: string | null;
  phone?: string | null;
  address?: ClientAddress | null;
}

const clean = (s: string | null | undefined) => (s ?? "").trim() || null;

/** Newest phone first, no repeats (compared on digits). */
function mergePhones(existing: string[], phone: string | null | undefined): string[] {
  const p = clean(phone);
  if (!p) return existing;
  const digits = phoneDigits(p);
  return [p, ...existing.filter((e) => phoneDigits(e) !== digits)].slice(0, 5);
}

async function emailsOf(clientId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select({ email: clientEmails.email }).from(clientEmails).where(eq(clientEmails.clientId, clientId)).orderBy(asc(clientEmails.createdAt));
  return rows.map((r) => r.email);
}

/** Recompute the search text after names, emails or phones change. */
async function refreshSearch(clientId: string) {
  const db = await getDb();
  const [c] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!c) return;
  const searchText = clientSearchText({ name: c.name, contactName: c.contactName, emails: await emailsOf(clientId), phones: c.phones });
  await db.update(clients).set({ searchText }).where(eq(clients.id, clientId));
}

/**
 * The client for this email, created if it's new, with the latest details copied on.
 * Every application and unfinished application goes through here, so prospects show up too.
 */
export async function ensureClient(details: ClientDetails): Promise<string> {
  const db = await getDb();
  const email = normalizeEmail(details.email);
  if (!email) throw new Error("A client needs an email");
  const contactName = clean(details.contactName);
  const businessName = clean(details.businessName);

  const [existing] = await db.select({ clientId: clientEmails.clientId }).from(clientEmails).where(eq(clientEmails.email, email)).limit(1);
  if (existing) {
    const [c] = await db.select().from(clients).where(eq(clients.id, existing.clientId)).limit(1);
    if (c) {
      await db
        .update(clients)
        .set({
          ...(businessName ? { name: businessName } : contactName && c.name === c.primaryEmail ? { name: contactName } : {}),
          ...(contactName ? { contactName } : {}),
          phones: mergePhones(c.phones, details.phone),
          ...(details.address && Object.values(details.address).some(Boolean) ? { address: details.address } : {}),
          updatedAt: new Date(),
        })
        .where(eq(clients.id, c.id));
      await refreshSearch(c.id);
      return c.id;
    }
  }

  const [created] = await db
    .insert(clients)
    .values({
      name: businessName ?? contactName ?? email,
      contactName,
      primaryEmail: email,
      phones: mergePhones([], details.phone),
      address: details.address ?? null,
    })
    .returning({ id: clients.id });
  // Two requests for the same new email at once: the first email row wins; drop the spare client.
  const [linked] = await db.insert(clientEmails).values({ email, clientId: created.id }).onConflictDoNothing().returning();
  if (!linked) {
    await db.delete(clients).where(eq(clients.id, created.id));
    return ensureClient(details);
  }
  await refreshSearch(created.id);
  await addClientEvent(created.id, "created", "system", { message: "Client record created" });
  return created.id;
}

/** Attach an application (and its client's unfinished applications) to the client for its email. */
export async function assignApplicationClient(applicationId: string, details: ClientDetails): Promise<string> {
  const db = await getDb();
  const clientId = await ensureClient(details);
  await db.update(applications).set({ clientId }).where(eq(applications.id, applicationId));
  await db.update(drafts).set({ clientId }).where(and(eq(drafts.email, normalizeEmail(details.email)), isNull(drafts.clientId)));
  return clientId;
}

export async function assignDraftClient(draftId: string, details: ClientDetails): Promise<string> {
  const db = await getDb();
  const clientId = await ensureClient(details);
  await db.update(drafts).set({ clientId }).where(eq(drafts.id, draftId));
  return clientId;
}

/** A client by ID. A merged-away record resolves to the client it was merged into. */
export async function getClient(id: string): Promise<Client | undefined> {
  if (!UUID_RE.test(id)) return undefined;
  const db = await getDb();
  for (let hops = 0, current = id; hops < 5; hops++) {
    const [c] = await db.select().from(clients).where(eq(clients.id, current)).limit(1);
    if (!c?.mergedInto) return c;
    current = c.mergedInto;
  }
  return undefined;
}

export async function getClientIdForEmail(email: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select({ clientId: clientEmails.clientId }).from(clientEmails).where(eq(clientEmails.email, normalizeEmail(email))).limit(1);
  return row?.clientId ?? null;
}

export { emailsOf as clientEmailsOf };

export async function setClientSalesforce(
  clientId: string,
  patch: Partial<Pick<Client, "sfAccountId" | "sfContactId" | "sfStatus" | "sfSyncedAt" | "sfLastError" | "ghlCompanyId">>,
) {
  const db = await getDb();
  await db.update(clients).set({ ...patch, updatedAt: new Date() }).where(eq(clients.id, clientId));
}

export async function addClientEvent(
  clientId: string,
  type: ClientEventType,
  actor: string,
  opts: { message?: string; data?: Record<string, unknown> } = {},
) {
  const db = await getDb();
  await db.insert(clientEvents).values({ clientId, type, actor, message: opts.message, data: opts.data });
}

export async function listClientEvents(clientId: string) {
  const db = await getDb();
  return db.select().from(clientEvents).where(eq(clientEvents.clientId, clientId)).orderBy(desc(clientEvents.createdAt), desc(clientEvents.id)).limit(200);
}

/** All applications for a client, newest first (list columns only: never the answers or signature). */
export async function listClientApplications(clientId: string) {
  const db = await getDb();
  return db
    .select({
      id: applications.id,
      reference: applications.reference,
      formSlug: applications.formSlug,
      status: applications.status,
      applicantEmail: applications.applicantEmail,
      businessName: applications.businessName,
      createdAt: applications.createdAt,
      isTest: applications.isTest,
      ghlOpportunityId: applications.ghlOpportunityId,
      sfOpportunityId: applications.sfOpportunityId,
      sfSyncStatus: applications.sfSyncStatus,
      sfLastError: applications.sfLastError,
    })
    .from(applications)
    .where(eq(applications.clientId, clientId))
    .orderBy(desc(applications.createdAt));
}

export async function listClientDrafts(clientId: string) {
  const db = await getDb();
  return db
    .select({ id: drafts.id, formSlug: drafts.formSlug, email: drafts.email, step: drafts.step, updatedAt: drafts.updatedAt })
    .from(drafts)
    .where(and(eq(drafts.clientId, clientId), eq(drafts.status, "started")))
    .orderBy(desc(drafts.updatedAt));
}

/** The Lead Alchemist contact for any of the client's emails (primary first). */
export async function clientGhlContactId(clientId: string): Promise<string | null> {
  const db = await getDb();
  const [c] = await db.select({ primaryEmail: clients.primaryEmail }).from(clients).where(eq(clients.id, clientId)).limit(1);
  const emails = await emailsOf(clientId);
  if (!emails.length) return null;
  const rows = await db.select().from(applicants).where(inArray(applicants.email, emails));
  const withId = rows.filter((r) => r.ghlContactId);
  return (withId.find((r) => r.email === c?.primaryEmail) ?? withId[0])?.ghlContactId ?? null;
}

export type ClientSort = "name" | "latest" | "applications";

export interface ClientListRow {
  id: string;
  name: string;
  contactName: string | null;
  primaryEmail: string;
  phone: string | null;
  address: ClientAddress | null;
  applications: number;
  latestAt: Date | null;
  latestStatus: ApplicationStatus | null;
  /** True when they have an unfinished application and no submitted one. */
  prospect: boolean;
  startedDrafts: number;
  sfStatus: SalesforceStatus;
  sfAccountId: string | null;
  ghlContactId: string | null;
  ghlCompanyId: string | null;
}

/** Search clause shared by the list and the CSV export. */
function searchWhere(q: string | undefined): SQL | undefined {
  const { text, digits } = searchTerms(q ?? "");
  if (!text) return undefined;
  const esc = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
  return digits ? or(ilike(clients.searchText, `%${esc(text)}%`), ilike(clients.searchText, `%${esc(digits)}%`)) : ilike(clients.searchText, `%${esc(text)}%`);
}

/** Clients and prospects for Admin → Clients, with counts and their latest application. */
export async function listClients({
  q,
  sort = "latest",
  page = 1,
  pageSize = 50,
}: { q?: string; sort?: ClientSort; page?: number; pageSize?: number } = {}): Promise<{ rows: ClientListRow[]; total: number }> {
  const db = await getDb();
  const where = and(isNull(clients.mergedInto), searchWhere(q));
  // Written out in full: inside a subquery a bare column could bind to the subquery's own table.
  const cid = sql.raw(`"clients"."id"`);
  const cPrimary = sql.raw(`"clients"."primary_email"`);
  const cCreated = sql.raw(`"clients"."created_at"`);
  const appCount = sql<number>`(select count(*) from ${applications} a where a.client_id = ${cid})`.mapWith(Number);
  const latestAt = sql<Date | null>`(select max(a.created_at) from ${applications} a where a.client_id = ${cid})`;
  const latestStatus = sql<ApplicationStatus | null>`(select a.status from ${applications} a where a.client_id = ${cid} order by a.created_at desc limit 1)`;
  const draftCount = sql<number>`(select count(*) from ${drafts} d where d.client_id = ${cid} and d.status = 'started')`.mapWith(Number);
  const lastActivity = sql`greatest(coalesce((select max(a.created_at) from ${applications} a where a.client_id = ${cid}), 'epoch'), coalesce((select max(d.updated_at) from ${drafts} d where d.client_id = ${cid}), 'epoch'), ${cCreated})`;
  const ghlContact = sql<string | null>`(select ap.ghl_contact_id from ${applicants} ap join ${clientEmails} ce on ce.email = ap.email where ce.client_id = ${cid} and ap.ghl_contact_id is not null order by (ap.email = ${cPrimary}) desc limit 1)`;
  const order =
    sort === "name" ? [asc(sql`lower(${clients.name})`)] : sort === "applications" ? [desc(appCount), desc(lastActivity)] : [desc(lastActivity)];
  const size = Math.min(Math.max(pageSize, 1), 500);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: clients.id,
        name: clients.name,
        contactName: clients.contactName,
        primaryEmail: clients.primaryEmail,
        phones: clients.phones,
        address: clients.address,
        applications: appCount,
        latestAt,
        latestStatus,
        startedDrafts: draftCount,
        sfStatus: clients.sfStatus,
        sfAccountId: clients.sfAccountId,
        ghlContactId: ghlContact,
        ghlCompanyId: clients.ghlCompanyId,
      })
      .from(clients)
      .where(where)
      .orderBy(...order, asc(clients.id))
      .limit(size)
      .offset((Math.max(page, 1) - 1) * size),
    db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(clients).where(where),
  ]);
  return {
    total,
    rows: rows.map(({ phones, latestAt: at, ...r }) => ({
      ...r,
      phone: phones[0] ?? null,
      latestAt: at ? new Date(at) : null,
      prospect: r.applications === 0 && r.startedDrafts > 0,
    })),
  };
}

const actorLabel = (actor: string) => actor.replace(/^staff:/, "");

/**
 * Merge `sourceId` into `targetId`: its emails, applications and unfinished applications move over,
 * Salesforce and Lead Alchemist IDs are kept where the target has none, and the source is marked merged.
 * Recorded on both, with what moved, so a mistaken merge can be split again by email.
 */
export async function mergeClients(targetId: string, sourceId: string, actor: string) {
  if (targetId === sourceId) throw new Error("Pick two different clients to merge.");
  const db = await getDb();
  const target = await getClient(targetId);
  const source = await getClient(sourceId);
  if (!target || !source || target.id === source.id) throw new Error("One of those clients doesn't exist (or they're already merged).");
  if (target.sfAccountId && source.sfAccountId && target.sfAccountId !== source.sfAccountId) {
    throw new Error("These clients are linked to different Salesforce Accounts. Merge the Accounts in Salesforce first, or unlink one.");
  }
  const moved = await emailsOf(source.id);
  await db.update(clientEmails).set({ clientId: target.id }).where(eq(clientEmails.clientId, source.id));
  await db.update(applications).set({ clientId: target.id }).where(eq(applications.clientId, source.id));
  await db.update(drafts).set({ clientId: target.id }).where(eq(drafts.clientId, source.id));
  await db
    .update(clients)
    .set({
      phones: [...target.phones, ...source.phones.filter((p) => !target.phones.some((t) => phoneDigits(t) === phoneDigits(p)))].slice(0, 5),
      address: target.address ?? source.address,
      sfAccountId: target.sfAccountId ?? source.sfAccountId,
      sfContactId: target.sfContactId ?? source.sfContactId,
      sfStatus: target.sfAccountId ? target.sfStatus : source.sfStatus,
      ghlCompanyId: target.ghlCompanyId ?? source.ghlCompanyId,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, target.id));
  await db.update(clients).set({ mergedInto: target.id, updatedAt: new Date() }).where(eq(clients.id, source.id));
  await refreshSearch(target.id);
  const data = { sourceId: source.id, targetId: target.id, emails: moved };
  await addClientEvent(target.id, "merged", actor, { message: `Merged in "${source.name}" (${moved.join(", ")}) by ${actorLabel(actor)}`, data });
  await addClientEvent(source.id, "merged", actor, { message: `Merged into "${target.name}" by ${actorLabel(actor)}`, data });
  return target.id;
}

/**
 * Undo a mistaken merge, or separate an email that belongs to someone else: the email, its
 * applications and unfinished applications move to a new client of their own. Salesforce
 * and Lead Alchemist links stay with the original client.
 */
export async function splitClientEmail(clientId: string, rawEmail: string, actor: string): Promise<string> {
  const db = await getDb();
  const email = normalizeEmail(rawEmail);
  const client = await getClient(clientId);
  if (!client) throw new Error("That client doesn't exist.");
  const emails = await emailsOf(client.id);
  if (!emails.includes(email)) throw new Error("That email isn't on this client.");
  if (emails.length < 2) throw new Error("A client needs at least one email, so its only email can't be split off.");

  const [latest] = await db
    .select({ name: applications.applicantName, business: applications.businessName, values: applications.values })
    .from(applications)
    .where(eq(applications.applicantEmail, email))
    .orderBy(desc(applications.createdAt))
    .limit(1);
  const [created] = await db
    .insert(clients)
    .values({
      name: latest?.business ?? latest?.name ?? email,
      contactName: latest?.name ?? null,
      primaryEmail: email,
      phones: typeof latest?.values.phone === "string" && latest.values.phone.trim() ? [latest.values.phone.trim()] : [],
    })
    .returning({ id: clients.id });
  await db.update(clientEmails).set({ clientId: created.id }).where(eq(clientEmails.email, email));
  await db.update(applications).set({ clientId: created.id }).where(and(eq(applications.clientId, client.id), eq(applications.applicantEmail, email)));
  await db.update(drafts).set({ clientId: created.id }).where(and(eq(drafts.clientId, client.id), eq(drafts.email, email)));
  if (client.primaryEmail === email) {
    await db.update(clients).set({ primaryEmail: emails.find((e) => e !== email)!, updatedAt: new Date() }).where(eq(clients.id, client.id));
  }
  await refreshSearch(client.id);
  await refreshSearch(created.id);
  const data = { fromId: client.id, newId: created.id, email };
  await addClientEvent(client.id, "split", actor, { message: `Split ${email} off into its own client by ${actorLabel(actor)}`, data });
  await addClientEvent(created.id, "split", actor, { message: `Split off from "${client.name}" by ${actorLabel(actor)}`, data });
  return created.id;
}

/** Make another of the client's emails the primary one. */
export async function setPrimaryEmail(clientId: string, rawEmail: string) {
  const db = await getDb();
  const email = normalizeEmail(rawEmail);
  if (!(await emailsOf(clientId)).includes(email)) throw new Error("That email isn't on this client.");
  await db.update(clients).set({ primaryEmail: email, updatedAt: new Date() }).where(eq(clients.id, clientId));
}

/** Client IDs whose Salesforce link fields are filled from a backfill: by Salesforce Account. */
export async function clientsForAccount(accountId: string) {
  const db = await getDb();
  return db.select().from(clients).where(and(eq(clients.sfAccountId, accountId), isNull(clients.mergedInto)));
}

/** Add an email to a client if no client has it yet. True when it was added (or was already this client's). */
export async function attachEmail(clientId: string, rawEmail: string): Promise<boolean> {
  const db = await getDb();
  const email = normalizeEmail(rawEmail);
  await db.insert(clientEmails).values({ email, clientId }).onConflictDoNothing();
  const [row] = await db.select({ clientId: clientEmails.clientId }).from(clientEmails).where(eq(clientEmails.email, email)).limit(1);
  if (row?.clientId === clientId) await refreshSearch(clientId);
  return row?.clientId === clientId;
}
