import "server-only";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { DirectoryContact } from "@/lib/db/schema";
import { nameKey, phoneDigits } from "@/lib/clients/text";
import { addClientEvent, createAccount, ensureContact, NO_ACCOUNT_TYPE, refreshSearch } from "@/lib/clients/repo";
import { ghlConfig, isScopeError, listBusinesses, listContactsPage, type GhlBusiness, type GhlContact } from "@/lib/ghl/client";
import { laName } from "@/lib/ghl/match";
import type { Links } from "@/lib/integrations/urls";
import { soqlString, type SalesforceApi } from "@/lib/salesforce/api";
import { visibleFields } from "@/lib/salesforce/fields";
import { syncAccount, syncContact } from "@/lib/salesforce/manager";
import { createContactsInSalesforce, syncContactsToLeadAlchemist, type BulkResult } from "@/lib/mapping/database";

/**
 * The contacts directory behind Admin → Contacts: every person in this app, Salesforce and Lead
 * Alchemist in one list. Salesforce Contacts and Lead Alchemist contacts are imported into
 * `directory_contacts` (Refresh, in time-boxed batches) and matched to the app's contacts by their
 * saved link, else email, else phone. Reads Salesforce and Lead Alchemist only; the sync actions
 * at the bottom are the only writes, and they create or link, never delete.
 */
export type DirectorySource = "salesforce" | "lead_alchemist";

export interface DirectoryImport {
  source: DirectorySource;
  phase: "running" | "done" | "failed";
  cursor: unknown;
  imported: number;
  total: number | null;
  startedAt: string;
  startedBy: string;
  finishedAt?: string;
  error?: string;
}

const KEY = (source: DirectorySource) => `directory_import_${source}`;
const rowsOf = <T,>(r: unknown) => (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];
const last10 = (p: string | null | undefined) => {
  const d = phoneDigits(p);
  return d.length >= 10 ? d.slice(-10) : null;
};
const lowerEmail = (e: string | null | undefined) => (e?.trim() ? e.trim().toLowerCase() : null);

export async function getImport(source: DirectorySource): Promise<DirectoryImport | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY(source))).limit(1);
  return (row?.value as DirectoryImport) ?? null;
}

async function saveImport(run: DirectoryImport) {
  const db = await getDb();
  await db
    .insert(schema.appSettings)
    .values({ key: KEY(run.source), value: run, updatedBy: run.startedBy })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: run, updatedAt: new Date() } });
  return run;
}

export async function directoryCounts() {
  const db = await getDb();
  const d = schema.directoryContacts;
  const [sf, la] = await Promise.all([
    db.$count(d, eq(d.source, "salesforce")),
    db.$count(d, eq(d.source, "lead_alchemist")),
  ]);
  return { salesforce: sf, leadAlchemist: la };
}

export async function startImport(source: DirectorySource, actor: string) {
  const current = await getImport(source);
  if (current?.phase === "running") return current;
  return saveImport({ source, phase: "running", cursor: null, imported: 0, total: null, startedAt: new Date().toISOString(), startedBy: actor });
}

type Row = Omit<DirectoryContact, "id" | "appContactId" | "matchHow" | "fetchedAt" | "companyKey">;

async function upsert(rows: Row[]) {
  if (!rows.length) return;
  const db = await getDb();
  const d = schema.directoryContacts;
  await db
    .insert(d)
    .values(rows.map((r) => ({ ...r, companyKey: r.companyName ? nameKey(r.companyName) || null : null, fetchedAt: new Date() })))
    .onConflictDoUpdate({
      target: [d.source, d.externalId],
      set: {
        name: sql`excluded.name`,
        email: sql`excluded.email`,
        phone: sql`excluded.phone`,
        companyId: sql`excluded.company_id`,
        companyName: sql`excluded.company_name`,
        companyKey: sql`excluded.company_key`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });
}

/** Keep the copy of Lead Alchemist's Companies current (the list suggests a Company for each person from it). */
export async function saveCompanies(businesses: GhlBusiness[]) {
  const db = await getDb();
  const t = schema.directoryCompanies;
  const now = new Date();
  for (let i = 0; i < businesses.length; i += 500) {
    await db
      .insert(t)
      .values(
        businesses.slice(i, i + 500).map((b) => ({ id: b.id, name: b.name ?? "", nameKey: nameKey(b.name), phone: last10(b.phone), website: b.website ?? null, fetchedAt: now })),
      )
      .onConflictDoUpdate({
        target: t.id,
        set: { name: sql`excluded.name`, nameKey: sql`excluded.name_key`, phone: sql`excluded.phone`, website: sql`excluded.website`, fetchedAt: sql`excluded.fetched_at` },
      });
  }
  await db.delete(t).where(lt(t.fetchedAt, now));
}

/** Rows saved before company names were keyed get their key (nameKey is code, not SQL). */
async function fillCompanyKeys() {
  const db = await getDb();
  const d = schema.directoryContacts;
  const missing = await db
    .select({ id: d.id, companyName: d.companyName })
    .from(d)
    .where(and(isNull(d.companyKey), sql`${d.companyName} is not null`))
    .limit(20_000);
  for (let i = 0; i < missing.length; i += 2000) {
    const keyed = JSON.stringify(missing.slice(i, i + 2000).map((r) => ({ id: r.id, k: nameKey(r.companyName) })));
    await db.execute(sql`update directory_contacts d set company_key = j.k from jsonb_to_recordset(${keyed}::jsonb) as j(id uuid, k text) where d.id = j.id`);
  }
}

/**
 * Match directory rows to the app's contacts: the saved link first, then the same email, then
 * the same phone (only when exactly one app contact has it). SQL only; cheap enough to run after
 * every import batch and sync action.
 */
export async function rematch() {
  const db = await getDb();
  await fillCompanyKeys();
  await db.execute(sql`
    update directory_contacts d set app_contact_id = c.id, match_how = 'linked'
    from contacts c
    where (d.source = 'salesforce' and c.sf_contact_id = d.external_id) or (d.source = 'lead_alchemist' and c.ghl_contact_id = d.external_id)`);
  await db.execute(sql`
    update directory_contacts d set app_contact_id = null, match_how = null
    where d.match_how = 'linked' and not exists (
      select 1 from contacts c where (d.source = 'salesforce' and c.sf_contact_id = d.external_id) or (d.source = 'lead_alchemist' and c.ghl_contact_id = d.external_id))`);
  await db.execute(sql`
    update directory_contacts d set app_contact_id = ce.contact_id, match_how = 'email'
    from contact_emails ce
    where d.match_how is distinct from 'linked' and d.email is not null and ce.email = d.email`);
  await db.execute(sql`
    update directory_contacts d set app_contact_id = m.contact_id, match_how = 'phone'
    from (
      select right(regexp_replace(p.value, '[^0-9]', '', 'g'), 10) as phone, min(c.id::text)::uuid as contact_id, count(*) as n
      from contacts c, jsonb_array_elements_text(c.phones) as p(value)
      group by 1
    ) m
    where d.match_how is null and d.app_contact_id is null and d.phone is not null and m.phone = d.phone and m.n = 1`);
}

const SF_BATCH = 200;

async function salesforceStep(sf: SalesforceApi, run: DirectoryImport) {
  const visible = await visibleFields(sf, "Contact", ["FirstName", "LastName", "Email", "Phone", "MobilePhone", "AccountId"]);
  const fields = ["Id", "Name", ...visible];
  const where = run.cursor ? ` WHERE Id > ${soqlString(String(run.cursor))}` : "";
  const query = (withAccount: boolean) =>
    sf.queryPage<Record<string, unknown> & { Id: string }>(
      `SELECT ${[...fields, ...(withAccount ? ["Account.Name"] : [])].join(", ")} FROM Contact${where} ORDER BY Id LIMIT ${SF_BATCH}`,
    );
  if (run.total === null) {
    run.total = await sf
      .queryPage("SELECT COUNT() FROM Contact")
      .then((r) => r.totalSize ?? null)
      .catch(() => null);
  }
  const page = await (visible.includes("AccountId") ? query(true).catch(() => query(false)) : query(false));
  const rows = salesforceRows(page.records);
  await upsert(rows);
  run.imported += rows.length;
  run.cursor = rows.at(-1)?.externalId ?? run.cursor;
  return rows.length < SF_BATCH;
}

/** Refresh AIS Connect's copy of these Salesforce Contacts (a change in Salesforce, by webhook). */
export async function refreshSalesforceContactCopy(sf: SalesforceApi, ids: string[]) {
  if (!ids.length) return [];
  const visible = await visibleFields(sf, "Contact", ["FirstName", "LastName", "Email", "Phone", "MobilePhone", "AccountId"]);
  const select = (withAccount: boolean) =>
    sf.query<Record<string, unknown> & { Id: string }>(
      `SELECT ${["Id", "Name", ...visible, ...(withAccount ? ["Account.Name"] : [])].join(", ")} FROM Contact WHERE Id IN (${ids.map(soqlString).join(", ")})`,
    );
  const records = await (visible.includes("AccountId") ? select(true).catch(() => select(false)) : select(false));
  const rows = salesforceRows(records);
  await upsert(rows);
  await rematch();
  return rows;
}

function salesforceRows(records: (Record<string, unknown> & { Id: string })[]): Row[] {
  return records.map((c) => ({
    source: "salesforce",
    externalId: c.Id,
    name: String(c.Name ?? [c.FirstName, c.LastName].filter(Boolean).join(" ") ?? ""),
    email: lowerEmail(c.Email as string | null),
    phone: last10((c.Phone as string | null) ?? (c.MobilePhone as string | null)),
    companyId: (c.AccountId as string | null) ?? null,
    companyName: ((c.Account as { Name?: string } | null)?.Name as string | undefined) ?? null,
  }));
}

async function leadAlchemistStep(run: DirectoryImport, companies: Map<string, string>) {
  const page = await listContactsPage(Array.isArray(run.cursor) ? run.cursor : null);
  if (run.total === null) run.total = page.total;
  const rows: Row[] = page.contacts.map((c: GhlContact) => ({
    source: "lead_alchemist",
    externalId: c.id,
    name: laName(c),
    email: lowerEmail(c.email),
    phone: last10(c.phone),
    companyId: c.businessId ?? null,
    companyName: (c.businessId ? companies.get(c.businessId) : null) ?? c.companyName ?? null,
  }));
  await upsert(rows);
  run.imported += rows.length;
  run.cursor = page.next;
  return !page.next;
}

/** One time-boxed batch of an import. The Contacts page calls it again until the phase isn't "running". */
export async function stepImport(source: DirectorySource, deps: { sf: SalesforceApi | null; timeBudgetMs?: number }) {
  const run = await getImport(source);
  if (!run || run.phase !== "running") return run;
  const started = Date.now();
  try {
    const companies = new Map<string, string>();
    if (source === "lead_alchemist") {
      if (!(await ghlConfig())) throw new Error("Lead Alchemist isn't connected.");
      const businesses = await listBusinesses().catch((err) => (isScopeError(err) ? null : Promise.reject(err)));
      for (const b of businesses ?? []) companies.set(b.id, b.name);
      // The first batch of a refresh also refreshes the copy of Lead Alchemist's Companies.
      if (businesses && run.cursor === null) await saveCompanies(businesses);
    } else if (!deps.sf) throw new Error("Salesforce isn't connected.");
    let finished = false;
    while (!finished && Date.now() - started < (deps.timeBudgetMs ?? 40_000)) {
      finished = source === "salesforce" ? await salesforceStep(deps.sf!, run) : await leadAlchemistStep(run, companies);
    }
    if (finished) {
      // Records gone from Salesforce / Lead Alchemist since the last refresh leave the directory.
      const db = await getDb();
      const d = schema.directoryContacts;
      await db.delete(d).where(and(eq(d.source, source), lt(d.fetchedAt, new Date(run.startedAt))));
      run.phase = "done";
      run.finishedAt = new Date().toISOString();
    }
  } catch (err) {
    run.phase = "failed";
    run.error = err instanceof Error ? err.message.slice(0, 300) : String(err);
  }
  await rematch();
  return saveImport(run);
}

// ── The list ───────────────────────────────────────────────────────────

export type DirectoryFilter = "all" | "app_only" | "sf_only" | "la_only" | "not_app" | "not_sf" | "not_la" | "everywhere" | "la_outdated" | "possible_dup";

export interface DirectoryRow {
  key: string;
  appContactId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  accountId: string | null;
  accountName: string | null;
  inApp: boolean;
  inSf: boolean;
  inLa: boolean;
  sfId: string | null;
  laId: string | null;
  sfCompany: string | null;
  laCompany: string | null;
  laCompanyId: string | null;
  sfAccountId: string | null;
  /** In the app and Lead Alchemist, but Lead Alchemist is missing (or has a different) name, email or phone. */
  laOutdated: boolean;
  /** Client tier on their AIS Connect account (null when they aren't in AIS Connect). */
  tier: "primary" | "secondary" | null;
  /** Their account's Salesforce Account Type. */
  accountType: string | null;
  /** Their AIS Connect account: their own, or (not in AIS Connect yet) the one linked to their Salesforce Account or Lead Alchemist Company. */
  account: { id: string; name: string; sfAccountId: string | null } | null;
  /** The Lead Alchemist Company they're in, or their account is linked to. */
  company: { id: string; name: string | null } | null;
  /** Otherwise, a Lead Alchemist Company that's probably theirs. */
  suggestedCompany: { id: string; name: string; how: string } | null;
  /** Someone with the same full name in a system they're not in yet. */
  sameName: { app: { accountId: string; account: string } | null; sf: { id: string; company: string | null } | null; la: { id: string; company: string | null } | null };
}

/** Whether their account is in AIS Connect, and their Lead Alchemist Company: linked, suggested or none. */
export type CompanyState = "linked" | "suggested" | "none";

export interface DirectoryQuery {
  q?: string;
  filter?: DirectoryFilter;
  presence?: Presence;
  account?: "yes" | "no";
  company?: CompanyState;
  /** Client tier on their AIS Connect account. */
  tier?: "primary" | "secondary";
  /** Their account's Salesforce Account Type (e.g. "Customer"), or NO_ACCOUNT_TYPE for none. */
  type?: string | null;
}

const FILTER_SQL: Record<DirectoryFilter, string> = {
  all: "true",
  app_only: "in_app and not in_sf and not in_la",
  sf_only: "in_sf and not in_app and not in_la",
  la_only: "in_la and not in_app and not in_sf",
  not_app: "not in_app",
  not_sf: "not in_sf",
  not_la: "not in_la",
  everywhere: "in_app and in_sf and in_la",
  la_outdated: "la_outdated",
  possible_dup: "(dup_app_account_id is not null or dup_sf_id is not null or dup_la_id is not null)",
};

const COMPANY_SQL: Record<CompanyState, string> = {
  linked: "co_id is not null",
  suggested: "co_id is null and sug_id is not null",
  none: "co_id is null and sug_id is null",
};

/** The WHERE clause for the list (over `enriched p`). */
function whereSql({ q, filter = "all", presence, account, company, tier, type }: DirectoryQuery) {
  const parts = [
    FILTER_SQL[filter],
    presenceSql(presence),
    account ? `acct_id is ${account === "yes" ? "not " : ""}null` : "true",
    company ? COMPANY_SQL[company] : "true",
    tier ? `tier = '${tier === "primary" ? "primary" : "secondary"}'` : "true",
  ];
  const typeSql = !type ? sql`` : type === NO_ACCOUNT_TYPE ? sql`and nullif(p.acct_type, '') is null` : sql`and p.acct_type = ${type}`;
  return sql`${sql.raw(parts.join(" and "))} ${searchSql(q)} ${typeSql}`;
}

/** In (yes) or not in (no) a system; leave a system out for "either". */
export type Presence = Partial<Record<"app" | "sf" | "la", "yes" | "no">>;
const PRESENCE_COLUMN = { app: "in_app", sf: "in_sf", la: "in_la" } as const;

function presenceSql(presence: Presence = {}) {
  const parts = (Object.keys(PRESENCE_COLUMN) as (keyof typeof PRESENCE_COLUMN)[])
    .filter((k) => presence[k] === "yes" || presence[k] === "no")
    .map((k) => `${presence[k] === "no" ? "not " : ""}${PRESENCE_COLUMN[k]}`);
  return parts.length ? parts.join(" and ") : "true";
}

function searchSql(q?: string) {
  const term = q?.trim() ? `%${q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const digits = q ? phoneDigits(q) : "";
  return term ? sql`and (lower(p.name) like ${term} or p.email like ${term}${digits.length >= 4 ? sql` or p.phone like ${`%${digits}%`}` : sql``})` : sql``;
}

/**
 * One row per person across the app, Salesforce and Lead Alchemist (the `flagged` CTE): an app
 * contact with the directory rows matched to it, or directory rows (Salesforce and Lead Alchemist
 * with the same email, say) not in the app yet.
 */
const peopleSql = () => sql`
    with ext as (
      select d.*, coalesce('a:' || d.app_contact_id::text, 'e:' || coalesce(d.email, 'p' || d.phone, d.source || ':' || d.external_id)) as pkey
      from directory_contacts d
    ),
    rows as (
      select 'a:' || c.id::text as pkey, c.id as app_id, c.client_id, c.name, c.primary_email as email,
        right(regexp_replace(coalesce(c.phones->>0, ''), '[^0-9]', '', 'g'), 10) as phone,
        c.sf_contact_id as sf_id, c.ghl_contact_id as la_id, null::text as sf_company, null::text as sf_company_id, null::text as sf_key,
        null::text as la_company, null::text as la_company_id, null::uuid as dir_id, true as from_app, 'app' as src
      from contacts c
      union all
      select pkey, app_contact_id, null, name, email, phone,
        case when source = 'salesforce' then external_id end, case when source = 'lead_alchemist' then external_id end,
        case when source = 'salesforce' then company_name end, case when source = 'salesforce' then company_id end,
        case when source = 'salesforce' then company_key end,
        case when source = 'lead_alchemist' then company_name end, case when source = 'lead_alchemist' then company_id end,
        id, false, source
      from ext
    ),
    people as (
      select pkey,
        max(app_id::text) as app_id, max(client_id::text) as client_id,
        coalesce(max(name) filter (where from_app), max(name)) as name,
        coalesce(max(email) filter (where from_app), max(email)) as email,
        coalesce(max(nullif(phone, '')) filter (where from_app), max(nullif(phone, ''))) as phone,
        bool_or(from_app) as in_app, bool_or(sf_id is not null) as in_sf, bool_or(la_id is not null) as in_la,
        max(sf_id) as sf_id, max(la_id) as la_id, max(sf_company) as sf_company, max(sf_company_id) as sf_company_id, max(sf_key) as sf_key,
        max(la_company) as la_company, max(la_company_id) as la_company_id,
        string_agg(dir_id::text, '.') as dir_ids,
        max(email) filter (where src = 'lead_alchemist') as la_email,
        max(nullif(phone, '')) filter (where src = 'lead_alchemist') as la_phone,
        max(name) filter (where src = 'lead_alchemist') as la_name,
        bool_or(src = 'lead_alchemist') as la_listed
      from rows group by pkey
    )
    , flagged as (
      select p.*, (
        in_app and la_listed and (
          (la_email is null and email is not null) or (la_email <> email)
          or (la_phone is null and phone is not null) or (la_phone <> phone)
          or coalesce(trim(la_name), '') = '' or la_name ~ '^[+0-9 ().-]{7,}$'
        )
      ) as la_outdated
      from people p
    )
`;

/**
 * peopleSql plus, for each person, what tells staff whether syncing would duplicate anything
 * (the `enriched` CTE):
 * - acct_*: their AIS Connect account: their own, or the one linked to their Salesforce Account
 *   or Lead Alchemist Company (so someone not in AIS Connect yet may already have one);
 * - co_*: the Lead Alchemist Company they're in, or their account is linked to;
 * - sug_*: otherwise, a Lead Alchemist Company that's probably theirs (same name as their account
 *   or Salesforce Account, or same phone), not linked to another account;
 * - dup_*: someone with the same full name already in a system they're not in (likely the same
 *   person under another email or phone).
 */
const enrichedSql = () => sql`
    ${peopleSql()}
    , enriched as (
      select f.*,
        acct.id as acct_id, acct.name as acct_name, acct.sf_account_id as acct_sf_id,
        case when f.app_id is null or f.client_id is null then null when acct.primary_contact_id::text = f.app_id then 'primary' else 'secondary' end as tier,
        -- Their account's Salesforce Account Type: the AIS Connect account's, else their Salesforce Account's.
        coalesce(nullif(acct.sf_account_type, ''), (select da.type from directory_accounts da where da.id = coalesce(acct.sf_account_id, f.sf_company_id))) as acct_type,
        coalesce(acct.ghl_company_id, f.la_company_id) as co_id,
        (select dc.name from directory_companies dc where dc.id = coalesce(acct.ghl_company_id, f.la_company_id)) as co_name,
        sug.id as sug_id, sug.name as sug_name, sug.how as sug_how,
        dup_app.client_id as dup_app_account_id, dup_app.account_name as dup_app_account,
        dup_sf.external_id as dup_sf_id, dup_sf.company_name as dup_sf_company,
        dup_la.external_id as dup_la_id, dup_la.company_name as dup_la_company
      from flagged f
      left join lateral (
        -- Each step uses its own index: their account, else the one linked to their Salesforce Account, else to their Company.
        select coalesce(
          f.client_id::uuid,
          (select c1.id from clients c1 where f.sf_company_id is not null and c1.sf_account_id = f.sf_company_id and c1.merged_into is null limit 1),
          (select c2.id from clients c2 where f.la_company_id is not null and c2.ghl_company_id = f.la_company_id and c2.merged_into is null limit 1)
        ) as id
      ) aid on true
      left join lateral (
        select cl.id::text as id, cl.name, cl.name_key, cl.phones, cl.ghl_company_id, cl.sf_account_id, cl.primary_contact_id, cl.sf_account_type from clients cl where cl.id = aid.id
      ) acct on true
      left join lateral (
        select dc.id, dc.name, case when dc.name_key = coalesce(nullif(acct.name_key, ''), f.sf_key) then 'same name' else 'same phone' end as how
        from directory_companies dc
        where acct.ghl_company_id is null and f.la_company_id is null
          and ((dc.name_key <> '' and dc.name_key = coalesce(nullif(acct.name_key, ''), f.sf_key))
            or (dc.phone is not null and (dc.phone = f.phone or dc.phone = right(regexp_replace(coalesce(acct.phones->>0, ''), '[^0-9]', '', 'g'), 10))))
          and not exists (select 1 from clients c2 where c2.ghl_company_id = dc.id and c2.merged_into is null)
        order by (dc.name_key = coalesce(nullif(acct.name_key, ''), f.sf_key)) desc, dc.name limit 1
      ) sug on true
      left join lateral (
        select c.client_id::text as client_id, cl.name as account_name from contacts c join clients cl on cl.id = c.client_id
        where not f.in_app and f.name like '% %' and length(f.name) >= 5 and lower(c.name) = lower(f.name) limit 1
      ) dup_app on true
      left join lateral (
        select d.external_id, d.company_name from directory_contacts d
        where not f.in_sf and f.name like '% %' and length(f.name) >= 5 and d.source = 'salesforce' and lower(d.name) = lower(f.name) limit 1
      ) dup_sf on true
      left join lateral (
        select d.external_id, d.company_name from directory_contacts d
        where not f.in_la and f.name like '% %' and length(f.name) >= 5 and d.source = 'lead_alchemist' and lower(d.name) = lower(f.name) limit 1
      ) dup_la on true
    )
`;

/**
 * Everyone in the app, Salesforce and Lead Alchemist, one row per person, filtered by where they
 * are (`presence`, any combination), a preset `filter`, and a name / email / phone search.
 */
export async function listDirectory({
  limit = 50,
  offset = 0,
  ...query
}: DirectoryQuery & { limit?: number; offset?: number }): Promise<{ rows: DirectoryRow[]; total: number }> {
  const db = await getDb();
  const result = await db.execute(sql`
    ${enrichedSql()}
    select p.*, count(*) over () as total
    from enriched p
    where ${whereSql(query)}
    order by lower(p.name), p.pkey
    limit ${Math.min(limit, 200)} offset ${offset}`);
  const raw = rowsOf<Record<string, unknown>>(result);
  const rows: DirectoryRow[] = raw.map((r) => ({
    key: r.app_id ? `a:${r.app_id}` : `d:${r.dir_ids}`,
    appContactId: (r.app_id as string) ?? null,
    name: (r.name as string) || (r.email as string) || "Unnamed",
    email: (r.email as string) ?? null,
    phone: (r.phone as string) || null,
    accountId: (r.client_id as string) ?? null,
    accountName: r.client_id ? ((r.acct_name as string) ?? null) : null,
    inApp: !!r.in_app,
    inSf: !!r.in_sf,
    inLa: !!r.in_la,
    sfId: (r.sf_id as string) ?? null,
    laId: (r.la_id as string) ?? null,
    sfCompany: (r.sf_company as string) ?? null,
    laCompany: (r.la_company as string) ?? null,
    laCompanyId: (r.la_company_id as string) ?? null,
    sfAccountId: (r.sf_company_id as string) ?? null,
    laOutdated: !!r.la_outdated,
    tier: (r.tier as "primary" | "secondary" | null) ?? null,
    accountType: (r.acct_type as string) ?? null,
    account: r.acct_id ? { id: r.acct_id as string, name: (r.acct_name as string) ?? "Account", sfAccountId: (r.acct_sf_id as string) ?? null } : null,
    company: r.co_id ? { id: r.co_id as string, name: (r.co_name as string) ?? (r.la_company as string) ?? null } : null,
    suggestedCompany: r.sug_id ? { id: r.sug_id as string, name: r.sug_name as string, how: r.sug_how as string } : null,
    sameName: {
      app: r.dup_app_account_id ? { accountId: r.dup_app_account_id as string, account: (r.dup_app_account as string) ?? "Account" } : null,
      sf: r.dup_sf_id ? { id: r.dup_sf_id as string, company: (r.dup_sf_company as string) ?? null } : null,
      la: r.dup_la_id ? { id: r.dup_la_id as string, company: (r.dup_la_company as string) ?? null } : null,
    },
  }));
  return { rows, total: Number(raw[0]?.total ?? 0) || (offset > 0 ? await countDirectory(query) : 0) };
}

/** Every row key the list shows for these filters (all pages), for "select all matching". */
export async function directoryKeys(query: DirectoryQuery): Promise<string[]> {
  const db = await getDb();
  const result = await db.execute(sql`
    ${enrichedSql()}
    select p.app_id, p.dir_ids from enriched p
    where ${whereSql(query)}
    order by lower(p.name), p.pkey`);
  return rowsOf<{ app_id: string | null; dir_ids: string | null }>(result).map((r) => (r.app_id ? `a:${r.app_id}` : `d:${r.dir_ids}`));
}

/** The total when a page past the end comes back empty (the window count needs a row). */
async function countDirectory(opts: DirectoryQuery): Promise<number> {
  const { rows, total } = await listDirectory({ ...opts, limit: 1, offset: 0 });
  return rows.length ? total : 0;
}

/**
 * How many people are in each combination of AIS Connect, Salesforce and Lead Alchemist (for the
 * "Where people are" table), plus how many have Lead Alchemist details to update. Honours the search.
 */
export async function directoryBreakdown(q?: string) {
  const db = await getDb();
  const result = await db.execute(sql`
    ${peopleSql()}
    select in_app, in_sf, in_la, count(*) as n, count(*) filter (where la_outdated) as outdated
    from flagged p where true ${searchSql(q)}
    group by in_app, in_sf, in_la`);
  const rows = rowsOf<{ in_app: boolean; in_sf: boolean; in_la: boolean; n: number | string; outdated: number | string }>(result);
  return {
    combos: rows.map((r) => ({ app: !!r.in_app, sf: !!r.in_sf, la: !!r.in_la, count: Number(r.n) })),
    total: rows.reduce((t, r) => t + Number(r.n), 0),
    laOutdated: rows.reduce((t, r) => t + Number(r.outdated), 0),
  };
}

// ── Sync actions ───────────────────────────────────────────────────────

/** Parse checkbox values: "a:<app contact id>" or "d:<directory id>.<directory id>…". */
export function parseKeys(values: string[]) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const app: string[] = [];
  const dir: string[][] = [];
  for (const v of values.slice(0, 200)) {
    if (v.startsWith("a:") && uuid.test(v.slice(2))) app.push(v.slice(2));
    else if (v.startsWith("d:")) {
      const ids = v.slice(2).split(".").filter((x) => uuid.test(x));
      if (ids.length) dir.push(ids);
    }
  }
  return { app, dir };
}

/**
 * Bring people who are only in Salesforce and/or Lead Alchemist into this app. A Salesforce
 * Contact comes in with its Account (synced into the app if it isn't yet); a Lead Alchemist
 * contact joins the account linked to its Company, else a new account named after the Company
 * (or after the person, as an individual). Returns the app contact IDs.
 */
export async function addToApp(groups: string[][], actor: string, deps: { sf: SalesforceApi | null; links: Links }, budgetMs = 40_000) {
  const db = await getDb();
  const d = schema.directoryContacts;
  const result: BulkResult & { contactIds: string[] } = { done: 0, notes: [], contactIds: [] };
  const started = Date.now();
  let left = groups.length;
  for (const [i, ids] of groups.entries()) {
    if (Date.now() - started > budgetMs) {
      result.notReached = groups.slice(i).map((g) => `d:${g.join(".")}`);
      break;
    }
    left--;
    const rows = await db.select().from(d).where(inArray(d.id, ids));
    if (!rows.length) continue;
    const linked = rows.find((r) => r.appContactId);
    if (linked?.appContactId) {
      result.contactIds.push(linked.appContactId);
      result.done++; // already in AIS Connect
      continue;
    }
    const sfRow = rows.find((r) => r.source === "salesforce");
    const laRow = rows.find((r) => r.source === "lead_alchemist");
    try {
      let contactId: string | null = null;
      if (sfRow && deps.sf) {
        if (sfRow.companyId) {
          const [account] = await db
            .select({ id: schema.clients.id })
            .from(schema.clients)
            .where(and(eq(schema.clients.sfAccountId, sfRow.companyId), isNull(schema.clients.mergedInto)))
            .limit(1);
          if (!account) await syncAccount(sfRow.companyId, { sf: deps.sf, links: deps.links, writeLinks: false }, actor);
          contactId = (await syncContact(deps.sf, sfRow.externalId, actor)).contact.id;
        } else {
          const account = await createAccount({ name: sfRow.name || sfRow.email || "Unnamed", isIndividual: true, primaryEmail: sfRow.email, phone: sfRow.phone, source: "salesforce" }, actor);
          contactId = (await ensureContact({ clientId: account.id, name: sfRow.name, email: sfRow.email, phone: sfRow.phone, sfContactId: sfRow.externalId })).id;
          await refreshSearch(account.id);
        }
      }
      if (laRow) {
        if (contactId) {
          await db.update(schema.contacts).set({ ghlContactId: laRow.externalId }).where(and(eq(schema.contacts.id, contactId), isNull(schema.contacts.ghlContactId)));
        } else {
          const [account] = laRow.companyId
            ? await db
                .select({ id: schema.clients.id })
                .from(schema.clients)
                .where(and(eq(schema.clients.ghlCompanyId, laRow.companyId), isNull(schema.clients.mergedInto)))
                .limit(1)
            : [];
          const accountId =
            account?.id ??
            (
              await createAccount(
                { name: laRow.companyName || laRow.name || laRow.email || "Unnamed", isIndividual: !laRow.companyName, primaryEmail: laRow.email, phone: laRow.phone, source: "lead_alchemist" },
                actor,
              )
            ).id;
          if (!account && laRow.companyId) await db.update(schema.clients).set({ ghlCompanyId: laRow.companyId }).where(eq(schema.clients.id, accountId));
          contactId = (await ensureContact({ clientId: accountId, name: laRow.name, email: laRow.email, phone: laRow.phone, ghlContactId: laRow.externalId })).id;
          await refreshSearch(accountId);
          await addClientEvent(accountId, "la_contact_linked", actor, { message: `Added ${laRow.name || "a contact"} from Lead Alchemist (Contacts page)` });
        }
      }
      if (contactId) {
        result.contactIds.push(contactId);
        result.done++;
      } else if (sfRow) result.notes.push(`${sfRow.name}: Salesforce isn't connected.`);
    } catch (err) {
      result.notes.push(`${(sfRow ?? laRow)!.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (left > 0) result.notes.unshift(`${left} weren't reached in this run (time limit per click): click again to do the rest.`);
  await rematch();
  return result;
}

/** Selected people → app (if needed) → Lead Alchemist, into their account's Company (the same sync as an account). */
export async function sendToLeadAlchemist(values: string[], actor: string, deps: { sf: SalesforceApi | null; links: Links }, createMissing: boolean) {
  const { app, dir } = parseKeys(values);
  const added = dir.length ? await addToApp(dir, actor, deps, 20_000) : { done: 0, notes: [], contactIds: [] };
  const ids = [...new Set([...app, ...added.contactIds])];
  if (!ids.length) return { done: 0, notes: added.notes };
  const r = await syncContactsToLeadAlchemist(ids, actor, deps, { createMissing, timeBudgetMs: 25_000 });
  await rematch();
  // People not reached go back in the queue by their AIS Connect key (they may have just been added).
  const notReached = [...(added.notReached ?? []), ...(r.notReached ?? []).map((id) => `a:${id}`)];
  return { done: r.done, notes: [...added.notes, ...r.notes], contacts: r.contacts, notReached };
}

/** Selected people → app (if needed) → Salesforce, under their account's Salesforce Account. */
export async function sendToSalesforce(values: string[], actor: string, deps: { sf: SalesforceApi; links: Links }) {
  const { app, dir } = parseKeys(values);
  const added = dir.length ? await addToApp(dir, actor, deps, 20_000) : { done: 0, notes: [], contactIds: [] };
  const r = await createContactsInSalesforce([...app, ...added.contactIds], actor, deps);
  await rematch();
  return { done: r.done, notes: [...added.notes, ...r.notes] };
}

export async function addSelectedToApp(values: string[], actor: string, deps: { sf: SalesforceApi | null; links: Links }) {
  const { app, dir } = parseKeys(values);
  const r = await addToApp(dir, actor, deps);
  // People already in AIS Connect are already where this puts them.
  return { done: r.done + app.length, notes: r.notes };
}

/** "Update in Lead Alchemist" for the selected people who are in the app and linked to Lead Alchemist. */
export async function updateLeadAlchemistForSelected(values: string[], actor: string, replace: boolean) {
  const { updateLeadAlchemistDetails } = await import("./external");
  const { app, dir } = parseKeys(values);
  const result: BulkResult = { done: 0, notes: [] };
  if (dir.length) result.notes.push(`${dir.length} ${dir.length === 1 ? "isn't" : "aren't"} in AIS Connect yet (add them first).`);
  const started = Date.now();
  let left = app.length;
  let unchanged = 0;
  for (const id of app) {
    if (Date.now() - started > 40_000) break;
    left--;
    try {
      const r = await updateLeadAlchemistDetails(id, actor, { replace });
      result.done++; // updated, or already matched (in step either way)
      if (!r.fields.length) unchanged++;
    } catch (err) {
      result.notes.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (unchanged) result.notes.push(`${unchanged} already matched Lead Alchemist.`);
  if (left > 0) result.notes.unshift(`${left} weren't reached in this run (time limit per click): click again to do the rest.`);
  return result;
}
