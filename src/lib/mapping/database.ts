import "server-only";
import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Client, Contact } from "@/lib/db/schema";
import { accountsOfContact, addClientEvent, listAccountContacts, contactEmailsOf, createAccount, getClient, getContact, setClientSalesforce, setContactSalesforce } from "@/lib/clients/repo";
import { laCompanyName, nameKey, searchTerms } from "@/lib/clients/text";
import { addContactsToBusiness, addTags, createBusiness, getContact as getLaContact, ghlConfig, isScopeError, listBusinesses, upsertContact, type GhlBusiness } from "@/lib/ghl/client";
import { exactMatch, laCandidates, linkLaContact } from "@/lib/ghl/match";
import type { Links } from "@/lib/integrations/urls";
import { soqlString, type SalesforceApi } from "@/lib/salesforce/api";
import { LINK_FIELDS, prepareFields } from "@/lib/salesforce/mapping";
import { companyMatchCounts, filterCompanyMatches, matchCompanies, type CompanyFilter, type MatchAccount } from "./company-match";

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

export async function listAccountMap({ q, filter = "all", page = 1, type, pageSize = PAGE }: { q?: string; filter?: AccountMapFilter; page?: number; type?: string | null; pageSize?: number }) {
  const size = Math.min(Math.max(pageSize, 1), 200);
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
  const where = and(isNull(c.mergedInto), isNull(c.deactivatedAt), textWhere(c.searchText, q), f, typeWhere);
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
      .limit(size)
      .offset((Math.max(1, page) - 1) * size),
    db.select({ total: count() }).from(c).where(where),
  ]);
  return { rows, total, pageSize: size };
}

/** Counts for the filter tabs. */
export async function mapCounts() {
  const db = await getDb();
  const c = schema.clients;
  const live = and(isNull(c.mergedInto), isNull(c.deactivatedAt));
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

export async function listContactMap({ q, filter = "all", page = 1, pageSize = PAGE }: { q?: string; filter?: ContactMapFilter; page?: number; pageSize?: number }) {
  const size = Math.min(Math.max(pageSize, 1), 200);
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
      .limit(size)
      .offset((Math.max(1, page) - 1) * size),
    db.select({ total: count() }).from(ct).innerJoin(c, eq(c.id, ct.clientId)).where(where),
  ]);
  return { rows, total, pageSize: size };
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

/** Every active Account, with what company matching needs. */
async function matchAccounts(): Promise<MatchAccount[]> {
  const db = await getDb();
  return db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      nameKey: schema.clients.nameKey,
      phones: schema.clients.phones,
      website: schema.clients.website,
      primaryEmail: schema.clients.primaryEmail,
      sfAccountId: schema.clients.sfAccountId,
      sfAccountType: schema.clients.sfAccountType,
      ghlCompanyId: schema.clients.ghlCompanyId,
    })
    .from(schema.clients)
    .where(and(isNull(schema.clients.mergedInto), isNull(schema.clients.deactivatedAt)));
}

/**
 * Every Lead Alchemist Company, read live, with the app Accounts (and so Salesforce Accounts) it
 * probably is. Reads only.
 */
export async function listCompanyMatches({ q, filter = "unlinked" }: { q?: string; filter?: CompanyFilter }) {
  const [businesses, accounts] = await Promise.all([listBusinesses(), matchAccounts()]);
  const all = matchCompanies(businesses, accounts).sort((a, b) => a.business.name.localeCompare(b.business.name));
  const term = q?.trim().toLowerCase();
  const searched = term ? all.filter((r) => [r.business.name, r.business.email, r.business.phone, r.business.website].some((v) => v?.toLowerCase().includes(term))) : all;
  return { rows: filterCompanyMatches(searched, filter), counts: companyMatchCounts(all) };
}

/** Link Lead Alchemist Companies to the Accounts staff picked (this app only; nothing changes in Lead Alchemist). */
export async function linkCompaniesToAccounts(pairs: { businessId: string; accountId: string }[], actor: string): Promise<BulkResult> {
  const result: BulkResult = { done: 0, notes: [] };
  const businesses = new Map((await listBusinesses()).map((b) => [b.id, b] as const));
  const db = await getDb();
  for (const { businessId, accountId } of pairs.slice(0, 100)) {
    const b = businesses.get(businessId);
    const account = await getClient(accountId);
    if (!b || !account) continue;
    if (account.ghlCompanyId === b.id) continue;
    if (account.ghlCompanyId) {
      result.notes.push(`${account.name} is already linked to another Lead Alchemist Company.`);
      continue;
    }
    const [taken] = await db
      .select({ name: schema.clients.name })
      .from(schema.clients)
      .where(and(eq(schema.clients.ghlCompanyId, b.id), isNull(schema.clients.mergedInto)))
      .limit(1);
    if (taken) {
      result.notes.push(`"${b.name}" is already linked to ${taken.name}.`);
      continue;
    }
    await setClientSalesforce(account.id, { ghlCompanyId: b.id });
    await addClientEvent(account.id, "la_company_linked", actor, { message: `Linked to Lead Alchemist Company "${b.name}" (${b.id}) from Mapping` });
    result.done++;
  }
  return result;
}

/** Add Lead Alchemist Companies with no match as new Accounts in this app (not in Salesforce). */
export async function addCompaniesToApp(businessIds: string[], actor: string): Promise<BulkResult> {
  const result: BulkResult = { done: 0, notes: [] };
  const businesses = new Map((await listBusinesses()).map((b) => [b.id, b] as const));
  const db = await getDb();
  for (const id of businessIds.slice(0, 100)) {
    const b = businesses.get(id);
    if (!b) continue;
    const [linked] = await db.select({ id: schema.clients.id }).from(schema.clients).where(and(eq(schema.clients.ghlCompanyId, b.id), isNull(schema.clients.mergedInto))).limit(1);
    if (linked) continue;
    const account = await createAccount(
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
    await addClientEvent(account.id, "la_company_linked", actor, { message: `Added from Lead Alchemist Company "${b.name}" (${b.id})` });
    result.done++;
  }
  return result;
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
export interface LeadAlchemistSyncOptions {
  /** Create a Lead Alchemist contact for people with no email or phone match there (it can start Lead Alchemist workflows). */
  createMissing?: boolean;
}

const COMPANIES_BLOCKED =
  "Companies were skipped: the Lead Alchemist token is missing the Companies scopes (Settings → Private Integrations → add businesses.readonly and businesses.write). Contacts were still linked.";

/**
 * Accounts → Lead Alchemist: link the Company with exactly the same name (or create it), then link
 * each person to their Lead Alchemist contact (or create it, when asked) and put them in the Company.
 * If the token can't use Companies, the contacts are still linked (and created) with the account
 * name as their company name, and the note says what to fix.
 */
export async function syncAccountsToLeadAlchemist(
  clientIds: string[],
  actor: string,
  deps: { sf: SalesforceApi | null; links: Links },
  opts: LeadAlchemistSyncOptions = {},
): Promise<BulkResult> {
  if (!(await ghlConfig())) throw new Error("Lead Alchemist isn't connected. Add the keys in Settings → Integrations.");
  let companies: GhlBusiness[] | null = await listBusinesses().catch((err) => {
    if (isScopeError(err)) return null;
    throw err;
  });
  const result: BulkResult = { done: 0, notes: [] };
  const db = await getDb();
  for (const id of clientIds.slice(0, 50)) {
    const account = await getClient(id);
    if (!account) continue;
    let companyId = account.ghlCompanyId;
    if (!companyId && companies) {
      const companyName = laCompanyName(account);
      const same = companies.filter((b) => nameKey(b.name) === nameKey(companyName));
      if (same.length > 1) {
        result.notes.push(`${account.name}: ${same.length} Lead Alchemist Companies have this name; pick one on the account's mapping row.`);
        continue;
      }
      try {
        if (same[0]) companyId = same[0].id;
        else {
          const created = await createBusiness({
            name: companyName,
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
      } catch (err) {
        if (!isScopeError(err)) throw err;
        companies = null;
        companyId = null;
      }
    }
    const people = await db.select().from(schema.contacts).where(eq(schema.contacts.clientId, account.id));
    const r = await connectContactsToCompany(people, companies ? companyId : null, actor, { ...opts, companyName: laCompanyName(account) });
    if (r.blocked) companies = null;
    if (r.notes.length) result.notes.push(...r.notes.map((n) => `${account.name}: ${n}`));
    if (deps.sf && account.sfAccountId) await writeAccountLinks(deps.sf, deps.links, { ...account, ghlCompanyId: companyId }).catch(() => {});
    result.done++;
  }
  if (!companies) result.notes.unshift(COMPANIES_BLOCKED);
  return result;
}

/**
 * Link each person to their Lead Alchemist contact (exact email or phone match only; created when
 * `createMissing` and there's no match at all) and add them to the Company. A contact already in a
 * different Company is left there. `companyId` null: link and create only.
 */
export async function connectContactsToCompany(
  people: Contact[],
  companyId: string | null,
  actor: string,
  opts: LeadAlchemistSyncOptions & { companyName?: string | null } = {},
): Promise<BulkResult & { blocked?: boolean }> {
  const result: BulkResult & { blocked?: boolean } = { done: 0, notes: [] };
  const toAdd: string[] = [];
  let unmatched = 0;
  let unclear = 0;
  let created = 0;
  let elsewhere = 0;
  for (const p of people) {
    let laId = p.ghlContactId;
    if (!laId) {
      const candidates = await laCandidates(p, { byName: false });
      const match = exactMatch(candidates);
      if (match) {
        await linkLaContact(p.id, match.id, actor);
        laId = match.id;
      } else if (candidates.length) {
        unclear++; // more than one Lead Alchemist contact shares this email or phone
        continue;
      } else if (opts.createMissing && (p.primaryEmail || p.phones[0])) {
        const res = await upsertContact({
          email: p.primaryEmail ?? undefined,
          firstName: p.firstName ?? (p.lastName ? undefined : p.name),
          lastName: p.lastName ?? undefined,
          phone: p.phones[0],
          companyName: opts.companyName ?? undefined,
          source: "Online Applications App",
        });
        await linkLaContact(p.id, res.contact.id, actor);
        laId = res.contact.id;
        created++;
      } else {
        unmatched++;
        continue;
      }
    }
    if (!companyId) continue;
    const la = await getLaContact(laId);
    if (!la) continue;
    if (la.businessId === companyId) continue;
    if (la.businessId) {
      elsewhere++;
      continue;
    }
    toAdd.push(laId);
  }
  if (toAdd.length && companyId) {
    try {
      await addContactsToBusiness(toAdd, companyId);
      result.done = toAdd.length;
    } catch (err) {
      if (!isScopeError(err)) throw err;
      result.blocked = true;
    }
  }
  if (created) result.notes.push(`${created} contact${created === 1 ? "" : "s"} created in Lead Alchemist`);
  if (unmatched)
    result.notes.push(
      `${unmatched} contact${unmatched === 1 ? " is" : "s are"} not in Lead Alchemist${opts.createMissing ? " and have no email or phone" : " (tick \"Create missing contacts\" to add them)"}`,
    );
  if (unclear) result.notes.push(`${unclear} contact${unclear === 1 ? " matches" : "s match"} more than one Lead Alchemist contact (pick by hand on the Salesforce Account page)`);
  if (elsewhere) result.notes.push(`${elsewhere} contact${elsewhere === 1 ? " is" : "s are"} already in a different Company (left there)`);
  return result;
}

/**
 * Contacts → Lead Alchemist: link each selected person (exact email or phone match; created when
 * `createMissing`), then add them to their account's Company when it has one.
 */
export async function connectSelectedContacts(contactIds: string[], actor: string, opts: LeadAlchemistSyncOptions = {}): Promise<BulkResult> {
  if (!(await ghlConfig())) throw new Error("Lead Alchemist isn't connected. Add the keys in Settings → Integrations.");
  const db = await getDb();
  const rows = await db
    .select({ contact: schema.contacts, account: { id: schema.clients.id, name: schema.clients.name, sfSnapshot: schema.clients.sfSnapshot, companyId: schema.clients.ghlCompanyId } })
    .from(schema.contacts)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.contacts.clientId))
    .where(inArray(schema.contacts.id, contactIds.slice(0, 100)));
  const result: BulkResult = { done: 0, notes: [] };
  const byAccount = new Map<string, { account: (typeof rows)[number]["account"]; people: Contact[] }>();
  for (const r of rows) byAccount.set(r.account.id, { account: r.account, people: [...(byAccount.get(r.account.id)?.people ?? []), r.contact] });
  let noCompany = 0;
  let blocked = false;
  for (const { account, people } of byAccount.values()) {
    if (!account.companyId) noCompany += people.length;
    const before = people.filter((p) => p.ghlContactId).length;
    const r = await connectContactsToCompany(people, blocked ? null : account.companyId, actor, { ...opts, companyName: laCompanyName(account) });
    blocked ||= !!r.blocked;
    // Done = now linked in Lead Alchemist (and in the Company where there is one).
    const linkedNow = (await db.select({ id: schema.contacts.id }).from(schema.contacts).where(and(inArray(schema.contacts.id, people.map((p) => p.id)), isNotNull(schema.contacts.ghlContactId)))).length;
    result.done += Math.max(linkedNow - before, 0) + r.done;
    result.notes.push(...r.notes.map((n) => `${account.name}: ${n}`));
  }
  if (blocked) result.notes.unshift(COMPANIES_BLOCKED);
  if (noCompany) result.notes.push(`${noCompany} contact${noCompany === 1 ? "'s account has" : "s' accounts have"} no Lead Alchemist Company yet: they were linked only (sync the account on the Accounts tab to add its Company).`);
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
 * (name, phone, website, billing address; never Type), then put the account's people under it.
 * Several Accounts with the same name are left for staff.
 */
export async function createAccountsInSalesforce(clientIds: string[], actor: string, deps: { sf: SalesforceApi; links: Links }): Promise<BulkResult> {
  const result: BulkResult = { done: 0, notes: [] };
  const [describe, contactDescribe] = await Promise.all([deps.sf.describe("Account"), deps.sf.describe("Contact")]);
  const placed: PlaceResult[] = [];
  for (const id of clientIds.slice(0, 50)) {
    const account = await getClient(id);
    if (!account) continue;
    if (account.sfAccountId) {
      // Already linked: still make sure its people are under it.
      for (const p of await listAccountContacts(account.id)) placed.push(await placeContactUnderAccount(p, account, deps, contactDescribe, actor));
      result.done++;
      continue;
    }
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
    // The people on the account (everyone who filled out its applications) go under the Account too.
    const linkedAccount = { ...account, sfAccountId: sfId };
    for (const p of await listAccountContacts(account.id)) placed.push(await placeContactUnderAccount(p, linkedAccount, deps, contactDescribe, actor));
    result.done++;
  }
  if (tally(placed)) result.notes.push(tally(placed));
  return result;
}

type PlaceResult = "created" | "linked" | "assigned" | "elsewhere" | "already";

/**
 * Put one person under a Salesforce Account:
 * - their Salesforce Contact (saved, or found by email) with no Account is assigned to it;
 * - one already under this Account is just linked;
 * - one under a different Account is linked but left where it is (never moved);
 * - otherwise a new Contact is created under the Account.
 */
async function placeContactUnderAccount(p: Contact, account: Client, deps: { sf: SalesforceApi; links: Links }, describe: Awaited<ReturnType<SalesforceApi["describe"]>>, actor: string): Promise<PlaceResult> {
  const sfAccountId = account.sfAccountId!;
  const email = p.primaryEmail ?? (await contactEmailsOf(p.id))[0] ?? null;
  type Row = { Id: string; AccountId: string | null };
  let found: Row | undefined;
  if (p.sfContactId) {
    [found] = await deps.sf.query<Row>(`SELECT Id, AccountId FROM Contact WHERE Id = ${soqlString(p.sfContactId)} LIMIT 1`);
  }
  if (!found && email) {
    const byEmail = await deps.sf.query<Row>(`SELECT Id, AccountId FROM Contact WHERE Email = ${soqlString(email)} ORDER BY CreatedDate ASC LIMIT 10`);
    found = byEmail.find((c) => c.AccountId === sfAccountId) ?? byEmail.find((c) => !c.AccountId) ?? byEmail[0];
  }
  let result: PlaceResult;
  let sfId: string;
  if (found) {
    sfId = found.Id;
    if (found.AccountId === sfAccountId) result = p.sfContactId === found.Id ? "already" : "linked";
    else if (!found.AccountId) {
      await deps.sf.update("Contact", found.Id, { AccountId: sfAccountId });
      result = "assigned";
    } else result = "elsewhere";
  } else {
    const { data } = prepareFields(describe, {
      AccountId: sfAccountId,
      FirstName: p.firstName,
      LastName: p.lastName || p.name || email || "Unknown",
      Email: email,
      Phone: p.phones[0],
      Title: p.title,
      [LINK_FIELDS.Contact.applications]: deps.links.appClient(account.id),
      [LINK_FIELDS.Contact.laContact]: deps.links.ghlContact(p.ghlContactId),
    });
    sfId = (await deps.sf.create("Contact", data)).id;
    result = "created";
  }
  if (p.sfContactId !== sfId) await setContactSalesforce(p.id, sfId);
  if (result !== "already") {
    const what = {
      created: "created under the Salesforce Account",
      linked: "linked to their Contact on the Salesforce Account",
      assigned: "their Salesforce Contact (which had no Account) was put under this Account",
      elsewhere: "linked to their Salesforce Contact, which stays under a different Account",
    }[result];
    await addClientEvent(account.id, "sf_linked", actor, { message: `${p.name}: ${what} (${sfId})` });
  }
  return result;
}

const tally = (results: PlaceResult[]) => {
  const n = (r: PlaceResult) => results.filter((x) => x === r).length;
  const parts = [
    n("created") && `${n("created")} contact${n("created") === 1 ? "" : "s"} created`,
    n("assigned") && `${n("assigned")} put under the Account`,
    n("linked") && `${n("linked")} already there and linked`,
    n("elsewhere") && `${n("elsewhere")} left under a different Salesforce Account`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : "";
};

/** Contacts → Salesforce: put each under their account's Salesforce Account (see placeContactUnderAccount). */
export async function createContactsInSalesforce(contactIds: string[], actor: string, deps: { sf: SalesforceApi; links: Links }): Promise<BulkResult> {
  const result: BulkResult = { done: 0, notes: [] };
  const describe = await deps.sf.describe("Contact");
  let noAccount = 0;
  const placed: PlaceResult[] = [];
  for (const id of contactIds.slice(0, 100)) {
    const p = await getContact(id);
    if (!p) continue;
    const account = await getClient(p.clientId);
    if (!account?.sfAccountId) {
      noAccount++;
      continue;
    }
    placed.push(await placeContactUnderAccount(p, account, deps, describe, actor));
    result.done++;
  }
  if (tally(placed)) result.notes.push(tally(placed));
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
/** Contacts tied to more than one account (their home account, applications, or extra accounts). */
const multiAccountWhere = () => sql`(
      select count(distinct x.cid) from (
        select ct.client_id as cid
        union select a.client_id from ${schema.applications} a where a.contact_id = ct.id and a.client_id is not null
        union select ac.client_id from ${schema.accountContacts} ac where ac.contact_id = ct.id
      ) x
    ) > 1`;

const rowsOf = <T,>(r: unknown) => (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];

export async function countMultiAccountContacts() {
  const db = await getDb();
  const [row] = rowsOf<{ n: number | string }>(await db.execute(sql`select count(*) as n from ${schema.contacts} ct where ${multiAccountWhere()}`));
  return Number(row?.n ?? 0);
}

export async function multiAccountContacts(limit = 200, offset = 0) {
  const db = await getDb();
  const rows = await db.execute<{ id: string }>(sql`
    select ct.id from ${schema.contacts} ct
    where ${multiAccountWhere()}
    order by lower(ct.name), ct.id
    limit ${limit} offset ${offset}`);
  const ids = rowsOf<{ id: string }>(rows).map((r) => r.id);
  const out = [];
  for (const id of ids) {
    const p = await getContact(id);
    if (p) out.push({ contact: p, accounts: await accountsOfContact(id) });
  }
  return out;
}
