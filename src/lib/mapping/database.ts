import "server-only";
import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Client, Contact } from "@/lib/db/schema";
import { accountsOfContact, addClientEvent, contactEmailsOf, createAccount, getClient, getContact, setClientSalesforce, setContactSalesforce } from "@/lib/clients/repo";
import { nameKey, searchTerms } from "@/lib/clients/text";
import { addContactsToBusiness, addTags, createBusiness, getContact as getLaContact, ghlConfig, listBusinesses, type GhlBusiness } from "@/lib/ghl/client";
import { exactMatch, laCandidates, linkLaContact } from "@/lib/ghl/match";
import type { Links } from "@/lib/integrations/urls";
import { soqlString, type SalesforceApi } from "@/lib/salesforce/api";
import { LINK_FIELDS, prepareFields } from "@/lib/salesforce/mapping";

/**
 * The mapping database (Admin → Mapping): every account and contact with its Salesforce and Lead
 * Alchemist links, filters for what isn't mapped yet, and bulk actions staff run by hand. Every
 * action reads, links, creates or fills in a link field; nothing is deleted or overwritten.
 */

export type AccountMapFilter = "all" | "sf_not_la" | "la_not_sf" | "neither" | "both";
export type ContactMapFilter = "all" | "no_la" | "no_sf" | "la_company_check";

const PAGE = 100;
const esc = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
function textWhere(column: typeof schema.clients.searchText | typeof schema.contacts.searchText, q?: string): SQL | undefined {
  const { text, digits } = searchTerms(q ?? "");
  if (!text) return undefined;
  return digits ? or(ilike(column, `%${esc(text)}%`), ilike(column, `%${esc(digits)}%`)) : ilike(column, `%${esc(text)}%`);
}

/** The Salesforce Account Types on the app's accounts, for the Type filter. */
export async function accountTypesInApp(): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .selectDistinct({ t: schema.clients.sfAccountType })
    .from(schema.clients)
    .where(and(isNotNull(schema.clients.sfAccountType), isNull(schema.clients.mergedInto)));
  return rows.map((r) => r.t!).sort();
}

export const NO_TYPE = "__none__";

export async function listAccountMap({ q, filter = "all", page = 1, type }: { q?: string; filter?: AccountMapFilter; page?: number; type?: string | null }) {
  const db = await getDb();
  const c = schema.clients;
  const f =
    filter === "sf_not_la"
      ? and(isNotNull(c.sfAccountId), isNull(c.ghlCompanyId))
      : filter === "la_not_sf"
        ? and(isNotNull(c.ghlCompanyId), isNull(c.sfAccountId))
        : filter === "neither"
          ? and(isNull(c.ghlCompanyId), isNull(c.sfAccountId))
          : filter === "both"
            ? and(isNotNull(c.ghlCompanyId), isNotNull(c.sfAccountId))
            : undefined;
  const typeWhere = type ? (type === NO_TYPE ? isNull(c.sfAccountType) : eq(c.sfAccountType, type)) : undefined;
  const where = and(isNull(c.mergedInto), textWhere(c.searchText, q), f, typeWhere);
  const cid = sql.raw(`"clients"."id"`);
  const people = sql<number>`(select count(*) from ${schema.contacts} ct where ct.client_id = ${cid})`.mapWith(Number);
  const inLa = sql<number>`(select count(*) from ${schema.contacts} ct where ct.client_id = ${cid} and ct.ghl_contact_id is not null)`.mapWith(Number);
  const inSf = sql<number>`(select count(*) from ${schema.contacts} ct where ct.client_id = ${cid} and ct.sf_contact_id is not null)`.mapWith(Number);
  const apps = sql<number>`(select count(*) from ${schema.applications} a where a.client_id = ${cid})`.mapWith(Number);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: c.id,
        name: c.name,
        isIndividual: c.isIndividual,
        sfAccountId: c.sfAccountId,
        ghlCompanyId: c.ghlCompanyId,
        sfSyncPaused: c.sfSyncPaused,
        sfAccountType: c.sfAccountType,
        people,
        inLa,
        inSf,
        apps,
      })
      .from(c)
      .where(where)
      .orderBy(asc(sql`lower(${c.name})`))
      .limit(PAGE)
      .offset((Math.max(1, page) - 1) * PAGE),
    db.select({ total: count() }).from(c).where(where),
  ]);
  return { rows, total, pageSize: PAGE };
}

/** Counts for the filter tabs. */
export async function mapCounts() {
  const db = await getDb();
  const c = schema.clients;
  const live = isNull(c.mergedInto);
  const n = async (w: SQL | undefined) => (await db.select({ n: count() }).from(c).where(and(live, w)))[0].n;
  const ct = schema.contacts;
  const nc = async (w: SQL | undefined) => (await db.select({ n: count() }).from(ct).where(w))[0].n;
  return {
    accounts: await n(undefined),
    sfNotLa: await n(and(isNotNull(c.sfAccountId), isNull(c.ghlCompanyId))),
    laNotSf: await n(and(isNotNull(c.ghlCompanyId), isNull(c.sfAccountId))),
    neither: await n(and(isNull(c.ghlCompanyId), isNull(c.sfAccountId))),
    contacts: await nc(undefined),
    contactsNoLa: await nc(isNull(ct.ghlContactId)),
    contactsNoSf: await nc(isNull(ct.sfContactId)),
  };
}

export async function listContactMap({ q, filter = "all", page = 1 }: { q?: string; filter?: ContactMapFilter; page?: number }) {
  const db = await getDb();
  const ct = schema.contacts;
  const c = schema.clients;
  const f =
    filter === "no_la"
      ? isNull(ct.ghlContactId)
      : filter === "no_sf"
        ? isNull(ct.sfContactId)
        : filter === "la_company_check"
          ? and(isNotNull(ct.ghlContactId), isNotNull(c.ghlCompanyId))
          : undefined;
  const where = and(textWhere(ct.searchText, q), f);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ contact: ct, accountName: c.name, accountSf: c.sfAccountId, accountCompany: c.ghlCompanyId })
      .from(ct)
      .innerJoin(c, eq(c.id, ct.clientId))
      .where(where)
      .orderBy(asc(sql`lower(${c.name})`), asc(ct.name))
      .limit(PAGE)
      .offset((Math.max(1, page) - 1) * PAGE),
    db.select({ total: count() }).from(ct).innerJoin(c, eq(c.id, ct.clientId)).where(where),
  ]);
  return { rows, total, pageSize: PAGE };
}

/** Lead Alchemist Companies that no app Account linked to Salesforce points at. */
export async function laCompaniesNotInSalesforce(q?: string) {
  const all = await listBusinesses();
  const db = await getDb();
  const linked = await db
    .select({ id: schema.clients.id, name: schema.clients.name, companyId: schema.clients.ghlCompanyId, sfAccountId: schema.clients.sfAccountId })
    .from(schema.clients)
    .where(and(isNotNull(schema.clients.ghlCompanyId), isNull(schema.clients.mergedInto)));
  const byCompany = new Map(linked.map((l) => [l.companyId!, l]));
  const term = q?.trim().toLowerCase();
  return all
    .filter((b) => !byCompany.get(b.id)?.sfAccountId)
    .filter((b) => !term || [b.name, b.email, b.phone, b.website].some((v) => v?.toLowerCase().includes(term)))
    .map((b) => ({ business: b, account: byCompany.get(b.id) ?? null }))
    .sort((a, b) => a.business.name.localeCompare(b.business.name));
}

// ── Bulk actions ──────────────────────────────────────────────────────

export interface BulkResult {
  done: number;
  notes: string[];
}

/** Write the app's links onto a Salesforce Account (only fields the org has, only when known). */
async function writeAccountLinks(sf: SalesforceApi, links: Links, account: Client) {
  if (!account.sfAccountId) return;
  const describe = await sf.describe("Account");
  const { data } = prepareFields(
    describe,
    { [LINK_FIELDS.Account.applications]: links.appClient(account.id), [LINK_FIELDS.Account.laCompany]: links.ghlCompany(account.ghlCompanyId) },
    "update",
  );
  if (Object.keys(data).length) await sf.update("Account", account.sfAccountId, data);
}

/**
 * Accounts → Lead Alchemist Companies: link the Company with the same name (one only) or create
 * one, then link each person to their Lead Alchemist contact (one exact email or phone match) and
 * add them to the Company. A contact already in a different Company is left there.
 */
export async function syncAccountsToLeadAlchemist(clientIds: string[], actor: string, deps: { sf: SalesforceApi | null; links: Links }): Promise<BulkResult> {
  if (!(await ghlConfig())) throw new Error("Lead Alchemist isn't connected. Add the keys in Settings → Integrations.");
  const companies = await listBusinesses();
  const result: BulkResult = { done: 0, notes: [] };
  const db = await getDb();
  for (const id of clientIds.slice(0, 50)) {
    const account = await getClient(id);
    if (!account) continue;
    let companyId = account.ghlCompanyId;
    if (!companyId) {
      const same = companies.filter((b) => nameKey(b.name) === account.nameKey);
      if (same.length > 1) {
        result.notes.push(`${account.name}: ${same.length} Lead Alchemist Companies have this name; pick one on the account's mapping row.`);
        continue;
      }
      if (same[0]) companyId = same[0].id;
      else {
        const created = await createBusiness({
          name: account.name,
          phone: account.phones[0] ?? null,
          email: account.primaryEmail,
          website: account.website,
          address: account.address?.street ?? null,
          city: account.address?.city ?? null,
          state: account.address?.state ?? null,
          postalCode: account.address?.postalCode ?? null,
          country: "US",
        });
        companies.push(created);
        companyId = created.id;
      }
      await setClientSalesforce(account.id, { ghlCompanyId: companyId });
      await addClientEvent(account.id, "la_company_linked", actor, { message: `${same[0] ? "Linked to" : "Created"} Lead Alchemist Company ${companyId}` });
    }
    const people = await db.select().from(schema.contacts).where(eq(schema.contacts.clientId, account.id));
    const r = await connectContactsToCompany(people, companyId, actor);
    if (r.notes.length) result.notes.push(...r.notes.map((n) => `${account.name}: ${n}`));
    if (deps.sf && account.sfAccountId) await writeAccountLinks(deps.sf, deps.links, { ...account, ghlCompanyId: companyId }).catch(() => {});
    result.done++;
  }
  return result;
}

/** Link each person to their Lead Alchemist contact (exact matches only) and add them to the Company. */
export async function connectContactsToCompany(people: Contact[], companyId: string, actor: string): Promise<BulkResult> {
  const result: BulkResult = { done: 0, notes: [] };
  const toAdd: string[] = [];
  let unmatched = 0;
  let elsewhere = 0;
  for (const p of people) {
    let laId = p.ghlContactId;
    if (!laId) {
      const match = exactMatch(await laCandidates(p, { byName: false }));
      if (!match) {
        unmatched++;
        continue;
      }
      await linkLaContact(p.id, match.id, actor);
      laId = match.id;
    }
    const la = await getLaContact(laId);
    if (!la) continue;
    if (la.businessId === companyId) continue;
    if (la.businessId) {
      elsewhere++;
      continue;
    }
    toAdd.push(laId);
  }
  if (toAdd.length) await addContactsToBusiness(toAdd, companyId);
  result.done = toAdd.length;
  if (unmatched) result.notes.push(`${unmatched} contact${unmatched === 1 ? " has" : "s have"} no single email or phone match in Lead Alchemist (pick by hand)`);
  if (elsewhere) result.notes.push(`${elsewhere} contact${elsewhere === 1 ? " is" : "s are"} already in a different Company (left there)`);
  return result;
}

/** "Connect to Company" for selected contacts: each joins their account's Company. */
export async function connectSelectedContacts(contactIds: string[], actor: string): Promise<BulkResult> {
  if (!(await ghlConfig())) throw new Error("Lead Alchemist isn't connected. Add the keys in Settings → Integrations.");
  const db = await getDb();
  const rows = await db
    .select({ contact: schema.contacts, companyId: schema.clients.ghlCompanyId })
    .from(schema.contacts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.contacts.clientId))
    .where(inArray(schema.contacts.id, contactIds.slice(0, 100)));
  const result: BulkResult = { done: 0, notes: [] };
  const byCompany = new Map<string, Contact[]>();
  let noCompany = 0;
  for (const r of rows) {
    if (!r.companyId) noCompany++;
    else byCompany.set(r.companyId, [...(byCompany.get(r.companyId) ?? []), r.contact]);
  }
  for (const [companyId, people] of byCompany) {
    const r = await connectContactsToCompany(people, companyId, actor);
    result.done += r.done;
    result.notes.push(...r.notes);
  }
  if (noCompany) result.notes.push(`${noCompany} contact${noCompany === 1 ? "'s account has" : "s' accounts have"} no Lead Alchemist Company yet (sync the account first)`);
  return result;
}

/** Link selected contacts to their Lead Alchemist contact where there's exactly one email or phone match. */
export async function linkContactsToLeadAlchemist(contactIds: string[], actor: string): Promise<BulkResult> {
  if (!(await ghlConfig())) throw new Error("Lead Alchemist isn't connected. Add the keys in Settings → Integrations.");
  const result: BulkResult = { done: 0, notes: [] };
  let unclear = 0;
  for (const id of contactIds.slice(0, 100)) {
    const p = await getContact(id);
    if (!p || p.ghlContactId) continue;
    const match = exactMatch(await laCandidates(p, { byName: false }));
    if (!match) {
      unclear++;
      continue;
    }
    await linkLaContact(p.id, match.id, actor);
    result.done++;
  }
  if (unclear) result.notes.push(`${unclear} had no single email or phone match: pick them on the Salesforce Account page`);
  return result;
}

/**
 * Accounts → Salesforce: link the Salesforce Account with exactly the same name, or create one
 * (name, phone, website, billing address). Several with the same name are left for staff.
 */
export async function createAccountsInSalesforce(clientIds: string[], actor: string, deps: { sf: SalesforceApi; links: Links }): Promise<BulkResult> {
  const result: BulkResult = { done: 0, notes: [] };
  const describe = await deps.sf.describe("Account");
  for (const id of clientIds.slice(0, 50)) {
    const account = await getClient(id);
    if (!account || account.sfAccountId) continue;
    const same = await deps.sf.query<{ Id: string }>(`SELECT Id FROM Account WHERE Name = ${soqlString(account.name)} LIMIT 3`);
    if (same.length > 1) {
      result.notes.push(`${account.name}: ${same.length} Salesforce Accounts have this name; sync the right one on Admin → Salesforce.`);
      continue;
    }
    let sfId = same[0]?.Id;
    if (!sfId) {
      const { data } = prepareFields(describe, {
        Name: account.name,
        Phone: account.phones[0],
        Website: account.website,
        BillingStreet: account.address?.street,
        BillingCity: account.address?.city,
        BillingState: account.address?.state,
        BillingPostalCode: account.address?.postalCode,
      });
      sfId = (await deps.sf.create("Account", data)).id;
    }
    await setClientSalesforce(account.id, { sfAccountId: sfId, sfStatus: "linked", sfLastError: null, sfSyncPaused: false });
    await addClientEvent(account.id, "sf_linked", actor, { message: `${same[0] ? "Linked to" : "Created"} Salesforce Account ${sfId}` });
    await writeAccountLinks(deps.sf, deps.links, { ...account, sfAccountId: sfId }).catch(() => {});
    result.done++;
  }
  return result;
}

/** Contacts → Salesforce: link the Contact with the same email on the account's Salesforce Account, or create one there. */
export async function createContactsInSalesforce(contactIds: string[], actor: string, deps: { sf: SalesforceApi; links: Links }): Promise<BulkResult> {
  const result: BulkResult = { done: 0, notes: [] };
  const describe = await deps.sf.describe("Contact");
  let noAccount = 0;
  for (const id of contactIds.slice(0, 100)) {
    const p = await getContact(id);
    if (!p || p.sfContactId) continue;
    const account = await getClient(p.clientId);
    if (!account?.sfAccountId) {
      noAccount++;
      continue;
    }
    const email = p.primaryEmail ?? (await contactEmailsOf(p.id))[0] ?? null;
    const [existing] = email
      ? await deps.sf.query<{ Id: string }>(`SELECT Id FROM Contact WHERE AccountId = ${soqlString(account.sfAccountId)} AND Email = ${soqlString(email)} LIMIT 1`)
      : [];
    let sfId = existing?.Id;
    if (!sfId) {
      const { data } = prepareFields(describe, {
        AccountId: account.sfAccountId,
        FirstName: p.firstName,
        LastName: p.lastName || p.name || email || "Unknown",
        Email: email,
        Phone: p.phones[0],
        Title: p.title,
        [LINK_FIELDS.Contact.applications]: deps.links.appClient(account.id),
        [LINK_FIELDS.Contact.laContact]: deps.links.ghlContact(p.ghlContactId),
      });
      sfId = (await deps.sf.create("Contact", data)).id;
    }
    await setContactSalesforce(p.id, sfId);
    await addClientEvent(account.id, "sf_linked", actor, { message: `${p.name}: ${existing ? "linked to" : "created"} Salesforce Contact ${sfId}` });
    result.done++;
  }
  if (noAccount) result.notes.push(`${noAccount} contact${noAccount === 1 ? "'s account isn't" : "s' accounts aren't"} in Salesforce yet (create the account first)`);
  return result;
}

/**
 * Lead Alchemist Companies → app and Salesforce: make (or reuse) the app Account for the Company,
 * then link or create the Salesforce Account.
 */
export async function companiesToSalesforce(businessIds: string[], actor: string, deps: { sf: SalesforceApi; links: Links }): Promise<BulkResult> {
  const all = new Map((await listBusinesses()).map((b) => [b.id, b] as const));
  const db = await getDb();
  const accountIds: string[] = [];
  const notes: string[] = [];
  for (const id of businessIds.slice(0, 50)) {
    const b: GhlBusiness | undefined = all.get(id);
    if (!b) continue;
    const [linked] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.ghlCompanyId, b.id), isNull(schema.clients.mergedInto)))
      .limit(1);
    let account = linked;
    if (!account) {
      account = await createAccount(
        {
          name: b.name,
          phone: b.phone,
          website: b.website,
          primaryEmail: b.email,
          address: { street: b.address ?? undefined, city: b.city ?? undefined, state: b.state ?? undefined, postalCode: b.postalCode ?? undefined },
        },
        actor,
      );
      await setClientSalesforce(account.id, { ghlCompanyId: b.id });
    }
    accountIds.push(account.id);
  }
  const r = await createAccountsInSalesforce(accountIds, actor, deps);
  return { done: r.done, notes: [...notes, ...r.notes] };
}

/**
 * A person at more than one company. Lead Alchemist keeps a contact in one Company, so the
 * contact stays in their main account's Company and each other account is added as a
 * "company: <name>" tag (tags are only ever added here). Nothing is moved.
 */
export async function pushCompanyTags(contactIds: string[], actor: string): Promise<BulkResult> {
  if (!(await ghlConfig())) throw new Error("Lead Alchemist isn't connected. Add the keys in Settings → Integrations.");
  const result: BulkResult = { done: 0, notes: [] };
  let notLinked = 0;
  for (const id of contactIds.slice(0, 100)) {
    const p = await getContact(id);
    if (!p) continue;
    if (!p.ghlContactId) {
      notLinked++;
      continue;
    }
    const accounts = await accountsOfContact(p.id);
    const la = await getLaContact(p.ghlContactId);
    if (!la) continue;
    const home = accounts.find((a) => a.home);
    if (!la.businessId && home?.ghlCompanyId) await addContactsToBusiness([p.ghlContactId], home.ghlCompanyId);
    const companyId = la.businessId ?? home?.ghlCompanyId ?? null;
    const others = accounts.filter((a) => !a.ghlCompanyId || a.ghlCompanyId !== companyId);
    if (others.length) await addTags(p.ghlContactId, others.map((a) => `company: ${a.name}`.slice(0, 100)));
    await addClientEvent(p.clientId, "la_contact_linked", actor, {
      message: `${p.name}: Lead Alchemist tags for ${others.length} other compan${others.length === 1 ? "y" : "ies"}${others.length ? ` (${others.map((a) => a.name).join(", ")})` : ""}`,
    });
    result.done++;
  }
  if (notLinked) result.notes.push(`${notLinked} contact${notLinked === 1 ? " isn't" : "s aren't"} linked to Lead Alchemist yet`);
  return result;
}

/** People tied to more than one account (for the mapping screen). */
export async function multiAccountContacts(limit = 200) {
  const db = await getDb();
  const rows = await db.execute<{ id: string }>(sql`
    select ct.id from ${schema.contacts} ct
    where (
      select count(distinct x.cid) from (
        select ct.client_id as cid
        union select a.client_id from ${schema.applications} a where a.contact_id = ct.id and a.client_id is not null
        union select ac.client_id from ${schema.accountContacts} ac where ac.contact_id = ct.id
      ) x
    ) > 1
    limit ${limit}`);
  const ids = (Array.isArray(rows) ? rows : (rows as { rows: { id: string }[] }).rows).map((r) => r.id);
  const out = [];
  for (const id of ids) {
    const p = await getContact(id);
    if (p) out.push({ contact: p, accounts: await accountsOfContact(id) });
  }
  return out;
}
