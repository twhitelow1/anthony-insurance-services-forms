import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Client, ClientAddress, ClientEventType, Contact, SalesforceStatus } from "@/lib/db/schema";
import type { ApplicationStatus } from "@/lib/applications/status";
import { businessDomain, clientSearchText, nameKey, phoneDigits, searchTerms, websiteDomain } from "./text";

/**
 * Accounts (the "clients" table) and their Contacts.
 * - An Account is a business; someone applying for themselves gets an individual Account named after them.
 * - A Contact is a person, found by email. Their home Account is contacts.client_id.
 * - Each application records the Account it's for (client_id) and the Contact who filled it out (contact_id).
 */
const { clients, contacts, contactEmails, clientEvents, applications, drafts } = schema;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export interface ClientDetails {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  /** The person's full name. */
  contactName?: string | null;
  businessName?: string | null;
  phone?: string | null;
  address?: ClientAddress | null;
  website?: string | null;
}

/** How an application's Account was found. "review": a new Account that shares only its name with another. */
export type AccountMatch = "contact" | "strong" | "new" | "review";

const clean = (s: string | null | undefined) => (s ?? "").trim() || null;
const personName = (d: Pick<ClientDetails, "contactName" | "firstName" | "lastName">) =>
  clean(d.contactName) ?? clean([d.firstName, d.lastName].map((s) => s?.trim()).filter(Boolean).join(" "));
const hasAddress = (a: ClientAddress | null | undefined) => !!a && Object.values(a).some(Boolean);

/** Newest phone first, no repeats (compared on digits). */
function mergePhones(existing: string[], phone: string | null | undefined): string[] {
  const p = clean(phone);
  if (!p) return existing;
  const digits = phoneDigits(p);
  return [p, ...existing.filter((e) => phoneDigits(e) !== digits)].slice(0, 5);
}

// ── Contacts ─────────────────────────────────────────────────────────

export async function getContactByEmail(email: string): Promise<Contact | undefined> {
  const db = await getDb();
  const [row] = await db
    .select({ contact: contacts })
    .from(contactEmails)
    .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
    .where(eq(contactEmails.email, normalizeEmail(email)))
    .limit(1);
  return row?.contact;
}

export async function getContact(id: string): Promise<Contact | undefined> {
  if (!UUID_RE.test(id)) return undefined;
  const db = await getDb();
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return c;
}

export async function contactEmailsOf(contactId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select({ email: contactEmails.email }).from(contactEmails).where(eq(contactEmails.contactId, contactId)).orderBy(asc(contactEmails.createdAt));
  return rows.map((r) => r.email);
}

async function refreshContactSearch(contactId: string) {
  const db = await getDb();
  const c = await getContact(contactId);
  if (!c) return;
  const searchText = clientSearchText({ name: c.name, emails: await contactEmailsOf(c.id), phones: c.phones });
  await db.update(contacts).set({ searchText }).where(eq(contacts.id, c.id));
}

export interface NewContact {
  clientId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  title?: string | null;
  phone?: string | null;
  sfContactId?: string | null;
  ghlContactId?: string | null;
}

/**
 * The Contact for this email (updated with any new details), or a new Contact on the given
 * Account. Contacts without an email (imported from Salesforce) are matched by Salesforce ID.
 */
export async function ensureContact(input: NewContact): Promise<Contact> {
  const db = await getDb();
  const email = input.email ? normalizeEmail(input.email) : null;
  const name = personName({ contactName: input.name, firstName: input.firstName, lastName: input.lastName }) ?? email ?? "Unnamed contact";
  const existing =
    (email ? await getContactByEmail(email) : undefined) ??
    (input.sfContactId ? (await db.select().from(contacts).where(eq(contacts.sfContactId, input.sfContactId)).limit(1))[0] : undefined);
  if (existing) {
    const [updated] = await db
      .update(contacts)
      .set({
        ...(clean(input.firstName) ? { firstName: clean(input.firstName) } : {}),
        ...(clean(input.lastName) ? { lastName: clean(input.lastName) } : {}),
        ...(personName(input) && existing.name !== personName(input) ? { name: personName(input)! } : {}),
        ...(clean(input.title) && !existing.title ? { title: clean(input.title) } : {}),
        phones: mergePhones(existing.phones, input.phone),
        ...(input.sfContactId && !existing.sfContactId ? { sfContactId: input.sfContactId } : {}),
        ...(input.ghlContactId && !existing.ghlContactId ? { ghlContactId: input.ghlContactId } : {}),
        ...(email && !existing.primaryEmail ? { primaryEmail: email } : {}),
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, existing.id))
      .returning();
    if (email) await db.insert(contactEmails).values({ email, contactId: existing.id }).onConflictDoNothing();
    await refreshContactSearch(existing.id);
    return updated;
  }
  const [created] = await db
    .insert(contacts)
    .values({
      clientId: input.clientId,
      firstName: clean(input.firstName),
      lastName: clean(input.lastName),
      name,
      title: clean(input.title),
      primaryEmail: email,
      phones: mergePhones([], input.phone),
      sfContactId: input.sfContactId ?? null,
      ghlContactId: input.ghlContactId ?? null,
    })
    .returning();
  if (email) {
    // Two requests for the same new email at once: the first email row wins; drop the spare contact.
    const [linked] = await db.insert(contactEmails).values({ email, contactId: created.id }).onConflictDoNothing().returning();
    if (!linked) {
      await db.delete(contacts).where(eq(contacts.id, created.id));
      return ensureContact(input);
    }
  }
  await refreshContactSearch(created.id);
  await addClientEvent(input.clientId, "contact_added", "system", { message: `Contact added: ${name}` });
  return created;
}

export async function getContactBySalesforceId(sfContactId: string): Promise<Contact | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(contacts).where(eq(contacts.sfContactId, sfContactId)).limit(1);
  return row;
}

export async function setContactSalesforce(contactId: string, sfContactId: string | null) {
  const db = await getDb();
  await db.update(contacts).set({ sfContactId, updatedAt: new Date() }).where(eq(contacts.id, contactId));
}

export async function setContactGhl(contactId: string, ghlContactId: string | null) {
  const db = await getDb();
  await db.update(contacts).set({ ghlContactId, updatedAt: new Date() }).where(eq(contacts.id, contactId));
}

/** Add an email to a contact if no contact has it yet. True when it was added (or was already theirs). */
export async function attachEmail(contactId: string, rawEmail: string): Promise<boolean> {
  const db = await getDb();
  const email = normalizeEmail(rawEmail);
  await db.insert(contactEmails).values({ email, contactId }).onConflictDoNothing();
  const [row] = await db.select({ contactId: contactEmails.contactId }).from(contactEmails).where(eq(contactEmails.email, email)).limit(1);
  if (row?.contactId === contactId) await refreshContactSearch(contactId);
  return row?.contactId === contactId;
}

// ── Accounts ─────────────────────────────────────────────────────────

/** An Account by ID. A merged-away record resolves to the Account it was merged into. */
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

/** The home Account of the contact with this email. */
export async function getClientIdForEmail(email: string): Promise<string | null> {
  const contact = await getContactByEmail(email);
  if (!contact) return null;
  return (await getClient(contact.clientId))?.id ?? null;
}

/** Every person tied to an Account: its own Contacts, plus anyone who filled out one of its applications. */
export async function listAccountContacts(clientId: string) {
  const db = await getDb();
  const viaApps = db.select({ id: applications.contactId }).from(applications).where(and(eq(applications.clientId, clientId), isNotNull(applications.contactId)));
  const rows = await db
    .select()
    .from(contacts)
    .where(or(eq(contacts.clientId, clientId), inArray(contacts.id, viaApps)))
    .orderBy(asc(contacts.createdAt));
  return rows.map((c) => ({ ...c, homeHere: c.clientId === clientId }));
}

/** Recompute the Account's search text: its name, phones and every Contact's name, emails and phones. */
export async function refreshSearch(clientId: string) {
  const db = await getDb();
  const [c] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!c) return;
  const people = await listAccountContacts(clientId);
  const emails = (await Promise.all(people.map((p) => contactEmailsOf(p.id)))).flat();
  const searchText = clientSearchText({
    name: c.name,
    contactName: people.map((p) => p.name).join(" "),
    emails,
    phones: [...c.phones, ...people.flatMap((p) => p.phones)],
  });
  const primary = people.find((p) => p.homeHere && p.primaryEmail) ?? people.find((p) => p.primaryEmail);
  await db
    .update(clients)
    .set({ searchText, primaryEmail: c.primaryEmail ?? primary?.primaryEmail ?? null, contactName: c.contactName ?? primary?.name ?? null })
    .where(eq(clients.id, clientId));
}

export interface NewAccount {
  name: string;
  isIndividual?: boolean;
  phone?: string | null;
  address?: ClientAddress | null;
  website?: string | null;
  sfAccountId?: string | null;
  primaryEmail?: string | null;
  possibleDuplicateOf?: string | null;
}

export async function createAccount(input: NewAccount, actor = "system"): Promise<Client> {
  const db = await getDb();
  const [created] = await db
    .insert(clients)
    .values({
      name: input.name.trim() || "Unnamed account",
      nameKey: nameKey(input.name),
      isIndividual: input.isIndividual ?? false,
      phones: mergePhones([], input.phone),
      address: hasAddress(input.address) ? input.address : null,
      website: clean(input.website),
      primaryEmail: input.primaryEmail ? normalizeEmail(input.primaryEmail) : null,
      sfAccountId: input.sfAccountId ?? null,
      sfStatus: input.sfAccountId ? "linked" : "not_synced",
      possibleDuplicateOf: input.possibleDuplicateOf ?? null,
    })
    .returning();
  await addClientEvent(created.id, "created", actor, { message: `Account created${input.isIndividual ? " (individual)" : ""}` });
  return created;
}

/** Fill in Account details that are new: phones are added, the address and website only when empty. */
async function touchAccount(account: Client, details: Pick<ClientDetails, "phone" | "address" | "website">) {
  const db = await getDb();
  await db
    .update(clients)
    .set({
      phones: mergePhones(account.phones, details.phone),
      ...(!hasAddress(account.address) && hasAddress(details.address) ? { address: details.address } : {}),
      ...(!account.website && clean(details.website) ? { website: clean(details.website) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(clients.id, account.id));
}

/** Business Accounts with this name (as nameKey compares them), not merged away. */
export async function accountsByNameKey(key: string): Promise<Client[]> {
  if (!key) return [];
  const db = await getDb();
  return db
    .select()
    .from(clients)
    .where(and(eq(clients.nameKey, key), eq(clients.isIndividual, false), isNull(clients.mergedInto)))
    .orderBy(desc(clients.updatedAt));
}

/** Business email domains of an Account's Contacts. */
async function accountDomains(clientId: string): Promise<Set<string>> {
  const people = await listAccountContacts(clientId);
  const emails = (await Promise.all(people.map((p) => contactEmailsOf(p.id)))).flat();
  return new Set(emails.map(businessDomain).filter((d): d is string => !!d));
}

/**
 * Same name, and something else that says it's the same business: a shared phone number,
 * the same business email domain, or the same website.
 */
export async function isStrongMatch(account: Client, details: Pick<ClientDetails, "email" | "phone" | "website">): Promise<boolean> {
  const digits = phoneDigits(details.phone);
  if (digits && account.phones.some((p) => phoneDigits(p) === digits)) return true;
  const site = websiteDomain(details.website);
  if (site && websiteDomain(account.website) === site) return true;
  const domain = businessDomain(details.email);
  if (domain && (domain === websiteDomain(account.website) || (await accountDomains(account.id)).has(domain))) return true;
  return false;
}

/**
 * The Account and Contact for an application (or an unfinished one):
 * 1. The Contact with this email, if their home Account is this business (or, for an individual, them).
 * 2. Otherwise a business Account with the same name AND the same phone, business email domain or website.
 * 3. A name-only match is a new Account flagged "possible duplicate" for staff to merge or keep.
 * 4. Otherwise a new Account. No business name → an individual Account named after the person.
 */
export async function resolveAccountAndContact(details: ClientDetails): Promise<{ clientId: string; contactId: string; match: AccountMatch }> {
  const email = normalizeEmail(details.email);
  if (!email) throw new Error("An application needs an email");
  const business = clean(details.businessName);
  const person = personName(details) ?? email;
  const existing = await getContactByEmail(email);
  const home = existing ? await getClient(existing.clientId) : undefined;

  let account: Client | undefined;
  let match: AccountMatch = "new";
  if (!business) {
    if (home?.isIndividual) {
      account = home;
      match = "contact";
    } else account = await createAccount({ name: person, isIndividual: true, phone: details.phone, address: details.address, primaryEmail: email });
  } else {
    const key = nameKey(business);
    if (home && !home.isIndividual && home.nameKey === key) {
      account = home;
      match = "contact";
    } else {
      const sameName = await accountsByNameKey(key);
      const strong: Client[] = [];
      for (const a of sameName) if (await isStrongMatch(a, details)) strong.push(a);
      if (strong.length === 1) {
        account = strong[0];
        match = "strong";
      } else {
        match = sameName.length ? "review" : "new";
        account = await createAccount({
          name: business,
          phone: details.phone,
          address: details.address,
          website: details.website,
          primaryEmail: email,
          possibleDuplicateOf: (strong[0] ?? sameName[0])?.id ?? null,
        });
      }
    }
  }
  if (match === "contact" || match === "strong") await touchAccount(account, details);

  const contact = await ensureContact({
    clientId: account.id,
    email,
    firstName: details.firstName,
    lastName: details.lastName,
    name: person,
    phone: details.phone,
  });
  await refreshSearch(account.id);
  if (contact.clientId !== account.id) await refreshSearch(contact.clientId);
  return { clientId: account.id, contactId: contact.id, match };
}

/** The Account for these details (created if new). */
export async function ensureClient(details: ClientDetails): Promise<string> {
  return (await resolveAccountAndContact(details)).clientId;
}

/** Attach an application, and the person's unfinished applications, to its Account and Contact. */
export async function assignApplicationClient(applicationId: string, details: ClientDetails): Promise<string> {
  const db = await getDb();
  const { clientId, contactId } = await resolveAccountAndContact(details);
  await db.update(applications).set({ clientId, contactId }).where(eq(applications.id, applicationId));
  await db.update(drafts).set({ clientId, contactId }).where(and(eq(drafts.email, normalizeEmail(details.email)), isNull(drafts.clientId)));
  return clientId;
}

export async function assignDraftClient(draftId: string, details: ClientDetails): Promise<string> {
  const db = await getDb();
  const { clientId, contactId } = await resolveAccountAndContact(details);
  await db.update(drafts).set({ clientId, contactId }).where(eq(drafts.id, draftId));
  return clientId;
}

export async function setClientSalesforce(
  clientId: string,
  patch: Partial<Pick<Client, "sfAccountId" | "sfStatus" | "sfSyncedAt" | "sfLastError" | "ghlCompanyId" | "sfSyncPaused" | "sfPulledAt">>,
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

/** All applications for an Account, newest first, with who filled each out (list columns only). */
export async function listClientApplications(clientId: string) {
  const db = await getDb();
  return db
    .select({
      id: applications.id,
      reference: applications.reference,
      formSlug: applications.formSlug,
      status: applications.status,
      applicantEmail: applications.applicantEmail,
      applicantName: applications.applicantName,
      contactId: applications.contactId,
      contactName: contacts.name,
      businessName: applications.businessName,
      createdAt: applications.createdAt,
      isTest: applications.isTest,
      ghlOpportunityId: applications.ghlOpportunityId,
      sfOpportunityId: applications.sfOpportunityId,
      sfSyncStatus: applications.sfSyncStatus,
      sfLastError: applications.sfLastError,
    })
    .from(applications)
    .leftJoin(contacts, eq(contacts.id, applications.contactId))
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

/** The Lead Alchemist contact to link from the Account: its primary Contact's, else any of its Contacts'. */
export async function clientGhlContactId(clientId: string): Promise<string | null> {
  const people = (await listAccountContacts(clientId)).filter((p) => p.ghlContactId);
  const [c] = await (await getDb()).select({ primaryEmail: clients.primaryEmail }).from(clients).where(eq(clients.id, clientId)).limit(1);
  return (people.find((p) => p.primaryEmail === c?.primaryEmail) ?? people.find((p) => p.homeHere) ?? people[0])?.ghlContactId ?? null;
}

export type ClientSort = "name" | "latest" | "applications";

export interface ClientListRow {
  id: string;
  name: string;
  isIndividual: boolean;
  contactName: string | null;
  primaryEmail: string | null;
  contacts: number;
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
  possibleDuplicateOf: string | null;
}

/** Search clause shared by the list and the CSV export. */
function searchWhere(q: string | undefined): SQL | undefined {
  const { text, digits } = searchTerms(q ?? "");
  if (!text) return undefined;
  const esc = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
  return digits ? or(ilike(clients.searchText, `%${esc(text)}%`), ilike(clients.searchText, `%${esc(digits)}%`)) : ilike(clients.searchText, `%${esc(text)}%`);
}

export type ClientFilter = "all" | "review" | "individuals" | "businesses";

/** Accounts for Admin → Accounts, with counts and their latest application. */
export async function listClients({
  q,
  sort = "latest",
  filter = "all",
  page = 1,
  pageSize = 50,
}: { q?: string; sort?: ClientSort; filter?: ClientFilter; page?: number; pageSize?: number } = {}): Promise<{ rows: ClientListRow[]; total: number }> {
  const db = await getDb();
  const filterWhere =
    filter === "review"
      ? isNotNull(clients.possibleDuplicateOf)
      : filter === "individuals"
        ? eq(clients.isIndividual, true)
        : filter === "businesses"
          ? eq(clients.isIndividual, false)
          : undefined;
  const where = and(isNull(clients.mergedInto), searchWhere(q), filterWhere);
  // Written out in full: inside a subquery a bare column could bind to the subquery's own table.
  const cid = sql.raw(`"clients"."id"`);
  const cPrimary = sql.raw(`"clients"."primary_email"`);
  const cCreated = sql.raw(`"clients"."created_at"`);
  const appCount = sql<number>`(select count(*) from ${applications} a where a.client_id = ${cid})`.mapWith(Number);
  const contactCount = sql<number>`(select count(*) from ${contacts} ct where ct.client_id = ${cid} or ct.id in (select a.contact_id from ${applications} a where a.client_id = ${cid}))`.mapWith(Number);
  const latestAt = sql<Date | null>`(select max(a.created_at) from ${applications} a where a.client_id = ${cid})`;
  const latestStatus = sql<ApplicationStatus | null>`(select a.status from ${applications} a where a.client_id = ${cid} order by a.created_at desc limit 1)`;
  const draftCount = sql<number>`(select count(*) from ${drafts} d where d.client_id = ${cid} and d.status = 'started')`.mapWith(Number);
  const lastActivity = sql`greatest(coalesce((select max(a.created_at) from ${applications} a where a.client_id = ${cid}), 'epoch'), coalesce((select max(d.updated_at) from ${drafts} d where d.client_id = ${cid}), 'epoch'), ${cCreated})`;
  const ghlContact = sql<string | null>`(select ct.ghl_contact_id from ${contacts} ct where ct.client_id = ${cid} and ct.ghl_contact_id is not null order by (ct.primary_email = ${cPrimary}) desc nulls last limit 1)`;
  const order =
    sort === "name" ? [asc(sql`lower(${clients.name})`)] : sort === "applications" ? [desc(appCount), desc(lastActivity)] : [desc(lastActivity)];
  const size = Math.min(Math.max(pageSize, 1), 500);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: clients.id,
        name: clients.name,
        isIndividual: clients.isIndividual,
        contactName: clients.contactName,
        primaryEmail: clients.primaryEmail,
        contacts: contactCount,
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
        possibleDuplicateOf: clients.possibleDuplicateOf,
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

/** How many Accounts wait for a "possible duplicate" decision. */
export async function countPossibleDuplicates(): Promise<number> {
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(clients)
    .where(and(isNull(clients.mergedInto), isNotNull(clients.possibleDuplicateOf)));
  return n;
}

const actorLabel = (actor: string) => actor.replace(/^staff:/, "");

/**
 * Merge `sourceId` into `targetId`: its Contacts, applications and unfinished applications move over,
 * Salesforce and Lead Alchemist IDs are kept where the target has none, and the source is marked merged.
 * Recorded on both, with what moved, so a mistaken merge can be split again by Contact.
 */
export async function mergeClients(targetId: string, sourceId: string, actor: string) {
  if (targetId === sourceId) throw new Error("Pick two different accounts to merge.");
  const db = await getDb();
  const target = await getClient(targetId);
  const source = await getClient(sourceId);
  if (!target || !source || target.id === source.id) throw new Error("One of those accounts doesn't exist (or they're already merged).");
  if (target.sfAccountId && source.sfAccountId && target.sfAccountId !== source.sfAccountId) {
    throw new Error("These accounts are linked to different Salesforce Accounts. Merge the Accounts in Salesforce first, or unlink one.");
  }
  if (target.ghlCompanyId && source.ghlCompanyId && target.ghlCompanyId !== source.ghlCompanyId) {
    throw new Error("These accounts are linked to different Lead Alchemist Companies. Merge the Companies in Lead Alchemist first.");
  }
  const moved = await db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(eq(contacts.clientId, source.id));
  await db.update(contacts).set({ clientId: target.id, updatedAt: new Date() }).where(eq(contacts.clientId, source.id));
  await db.update(applications).set({ clientId: target.id }).where(eq(applications.clientId, source.id));
  await db.update(drafts).set({ clientId: target.id }).where(eq(drafts.clientId, source.id));
  await db
    .update(clients)
    .set({
      phones: [...target.phones, ...source.phones.filter((p) => !target.phones.some((t) => phoneDigits(t) === phoneDigits(p)))].slice(0, 5),
      address: target.address ?? source.address,
      website: target.website ?? source.website,
      sfAccountId: target.sfAccountId ?? source.sfAccountId,
      sfStatus: target.sfAccountId ? target.sfStatus : source.sfStatus,
      ghlCompanyId: target.ghlCompanyId ?? source.ghlCompanyId,
      possibleDuplicateOf: target.possibleDuplicateOf === source.id ? null : target.possibleDuplicateOf,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, target.id));
  await db.update(clients).set({ mergedInto: target.id, possibleDuplicateOf: null, updatedAt: new Date() }).where(eq(clients.id, source.id));
  // Anything flagged as a possible duplicate of the merged-away Account now points at the target.
  await db.update(clients).set({ possibleDuplicateOf: target.id }).where(and(eq(clients.possibleDuplicateOf, source.id), ne(clients.id, target.id)));
  await refreshSearch(target.id);
  const data = { sourceId: source.id, targetId: target.id, contacts: moved.map((m) => m.id) };
  const names = moved.map((m) => m.name).join(", ");
  await addClientEvent(target.id, "merged", actor, { message: `Merged in "${source.name}"${names ? ` (${names})` : ""} by ${actorLabel(actor)}`, data });
  await addClientEvent(source.id, "merged", actor, { message: `Merged into "${target.name}" by ${actorLabel(actor)}`, data });
  return target.id;
}

/** Keep an Account flagged as a possible duplicate: it's a different business with the same name. */
export async function keepSeparate(clientId: string, actor: string) {
  const db = await getDb();
  await db.update(clients).set({ possibleDuplicateOf: null, updatedAt: new Date() }).where(eq(clients.id, clientId));
  await addClientEvent(clientId, "duplicate_resolved", actor, { message: `Kept as a separate account by ${actorLabel(actor)}` });
}

/**
 * Undo a mistaken merge, or separate someone who belongs elsewhere: the Contact, with the
 * applications they filled out for this Account, moves to a new Account of their own.
 * Salesforce and Lead Alchemist links stay with the original Account.
 */
export async function splitContact(clientId: string, contactId: string, actor: string): Promise<string> {
  const db = await getDb();
  const client = await getClient(clientId);
  if (!client) throw new Error("That account doesn't exist.");
  const contact = await getContact(contactId);
  if (!contact) throw new Error("That contact doesn't exist.");
  const people = await listAccountContacts(client.id);
  if (!people.some((p) => p.id === contact.id)) throw new Error("That contact isn't on this account.");
  if (people.length < 2) throw new Error("This is the account's only contact, so there's nothing to split it from.");

  const [latest] = await db
    .select({ business: applications.businessName })
    .from(applications)
    .where(and(eq(applications.clientId, client.id), eq(applications.contactId, contact.id)))
    .orderBy(desc(applications.createdAt))
    .limit(1);
  const business = clean(latest?.business);
  const created = await createAccount({ name: business ?? contact.name, isIndividual: !business, phone: contact.phones[0], primaryEmail: contact.primaryEmail }, actor);
  await db.update(contacts).set({ clientId: created.id, updatedAt: new Date() }).where(eq(contacts.id, contact.id));
  await db.update(applications).set({ clientId: created.id }).where(and(eq(applications.clientId, client.id), eq(applications.contactId, contact.id)));
  await db.update(drafts).set({ clientId: created.id }).where(and(eq(drafts.clientId, client.id), eq(drafts.contactId, contact.id)));
  if (client.primaryEmail && client.primaryEmail === contact.primaryEmail) {
    const other = people.find((p) => p.id !== contact.id && p.primaryEmail);
    await db.update(clients).set({ primaryEmail: other?.primaryEmail ?? null, contactName: other?.name ?? null }).where(eq(clients.id, client.id));
  }
  await refreshSearch(client.id);
  await refreshSearch(created.id);
  const data = { fromId: client.id, newId: created.id, contactId: contact.id };
  await addClientEvent(client.id, "split", actor, { message: `Split ${contact.name} off into an account of their own by ${actorLabel(actor)}`, data });
  await addClientEvent(created.id, "split", actor, { message: `Split off from "${client.name}" by ${actorLabel(actor)}`, data });
  return created.id;
}

/** Make another of the Account's Contacts the primary one. */
export async function setPrimaryContact(clientId: string, contactId: string) {
  const db = await getDb();
  const people = await listAccountContacts(clientId);
  const c = people.find((p) => p.id === contactId);
  if (!c) throw new Error("That contact isn't on this account.");
  await db.update(clients).set({ primaryEmail: c.primaryEmail, contactName: c.name, updatedAt: new Date() }).where(eq(clients.id, clientId));
}

/** Accounts linked to this Salesforce Account. */
export async function clientsForAccount(accountId: string) {
  const db = await getDb();
  return db.select().from(clients).where(and(eq(clients.sfAccountId, accountId), isNull(clients.mergedInto)));
}

/** Accounts linked to this Lead Alchemist Company. */
export async function clientsForCompany(companyId: string) {
  const db = await getDb();
  return db.select().from(clients).where(and(eq(clients.ghlCompanyId, companyId), isNull(clients.mergedInto)));
}
