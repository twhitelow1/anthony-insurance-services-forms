import "server-only";
import { eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { nameKey, phoneDigits } from "@/lib/clients/text";
import { saveCompanies } from "@/lib/contacts/directory";
import { ghlConfig, isScopeError, listBusinesses } from "@/lib/ghl/client";
import type { Links } from "@/lib/integrations/urls";
import { addCompaniesToApp, createAccountsInSalesforce, linkCompaniesToAccounts, syncAccountsToLeadAlchemist, type BulkResult } from "@/lib/mapping/database";
import { soqlString, type SalesforceApi } from "@/lib/salesforce/api";
import { visibleFields } from "@/lib/salesforce/fields";
import { relinkSalesforceAccount, syncAccount } from "@/lib/salesforce/manager";

/**
 * Accounts across all three systems (Accounts → "Across all three"): every AIS Connect account,
 * plus the Salesforce Accounts and Lead Alchemist Companies not linked to one, with how many
 * contacts each has in each system and, where something isn't linked yet, a likely match in the
 * other systems (same name, else same phone). Salesforce Accounts and Lead Alchemist Companies
 * are read into copies (Refresh, read-only). The sync actions link to a match where there is one
 * and create only when there isn't; nothing is deleted anywhere.
 */
export type AccountSource = "salesforce" | "lead_alchemist";

export interface AccountImport {
  source: AccountSource;
  phase: "running" | "done" | "failed";
  cursor: string | null;
  imported: number;
  total: number | null;
  startedAt: string;
  startedBy: string;
  finishedAt?: string;
  error?: string;
}

const KEY = (source: AccountSource) => `account_directory_import_${source}`;
const rowsOf = <T,>(r: unknown) => (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];
const last10 = (p: unknown) => {
  const d = phoneDigits(typeof p === "string" ? p : null);
  return d.length >= 10 ? d.slice(-10) : null;
};

export async function getAccountImport(source: AccountSource): Promise<AccountImport | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY(source))).limit(1);
  return (row?.value as AccountImport) ?? null;
}

async function saveImport(run: AccountImport) {
  const db = await getDb();
  await db
    .insert(schema.appSettings)
    .values({ key: KEY(run.source), value: run, updatedBy: run.startedBy })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: run, updatedAt: new Date() } });
  return run;
}

export async function accountDirectoryCounts() {
  const db = await getDb();
  const [salesforce, leadAlchemist] = await Promise.all([db.$count(schema.directoryAccounts), db.$count(schema.directoryCompanies)]);
  return { salesforce, leadAlchemist };
}

export async function startAccountImport(source: AccountSource, actor: string) {
  const current = await getAccountImport(source);
  if (current?.phase === "running") return current;
  return saveImport({ source, phase: "running", cursor: null, imported: 0, total: null, startedAt: new Date().toISOString(), startedBy: actor });
}

const SF_BATCH = 200;

async function salesforceBatch(sf: SalesforceApi, run: AccountImport) {
  const visible = await visibleFields(sf, "Account", ["Phone", "Website", "Type"]);
  if (run.total === null) {
    run.total = await sf
      .queryPage("SELECT COUNT() FROM Account")
      .then((r) => r.totalSize ?? null)
      .catch(() => null);
  }
  const where = run.cursor ? ` WHERE Id > ${soqlString(run.cursor)}` : "";
  const page = await sf.queryPage<Record<string, unknown> & { Id: string; Name: string }>(
    `SELECT ${["Id", "Name", ...visible].join(", ")} FROM Account${where} ORDER BY Id LIMIT ${SF_BATCH}`,
  );
  const rows = page.records.map((a) => ({
    id: a.Id,
    name: String(a.Name ?? ""),
    nameKey: nameKey(String(a.Name ?? "")),
    phone: last10(a.Phone),
    website: (a.Website as string | null) ?? null,
    type: (a.Type as string | null) ?? null,
    fetchedAt: new Date(),
  }));
  if (rows.length) {
    const db = await getDb();
    const t = schema.directoryAccounts;
    await db
      .insert(t)
      .values(rows)
      .onConflictDoUpdate({
        target: t.id,
        set: { name: sql`excluded.name`, nameKey: sql`excluded.name_key`, phone: sql`excluded.phone`, website: sql`excluded.website`, type: sql`excluded.type`, fetchedAt: sql`excluded.fetched_at` },
      });
  }
  run.imported += rows.length;
  run.cursor = rows.at(-1)?.id ?? run.cursor;
  return rows.length < SF_BATCH;
}

/** One time-boxed batch of a refresh. The page calls it again until the phase isn't "running". */
export async function stepAccountImport(source: AccountSource, deps: { sf: SalesforceApi | null; timeBudgetMs?: number }) {
  const run = await getAccountImport(source);
  if (!run || run.phase !== "running") return run;
  const started = Date.now();
  try {
    if (source === "lead_alchemist") {
      if (!(await ghlConfig())) throw new Error("Lead Alchemist isn't connected.");
      const businesses = await listBusinesses().catch((err) => {
        if (isScopeError(err)) throw new Error("The Lead Alchemist key can't read Companies (add the Companies scopes in Lead Alchemist).");
        throw err;
      });
      await saveCompanies(businesses);
      run.imported = businesses.length;
      run.total = businesses.length;
      run.phase = "done";
    } else {
      if (!deps.sf) throw new Error("Salesforce isn't connected.");
      let finished = false;
      while (!finished && Date.now() - started < (deps.timeBudgetMs ?? 40_000)) finished = await salesforceBatch(deps.sf, run);
      if (finished) {
        // Accounts gone from Salesforce since the last refresh leave the copy.
        const db = await getDb();
        await db.delete(schema.directoryAccounts).where(lt(schema.directoryAccounts.fetchedAt, new Date(run.startedAt)));
        run.phase = "done";
      }
    }
    if (run.phase === "done") run.finishedAt = new Date().toISOString();
  } catch (err) {
    run.phase = "failed";
    run.error = err instanceof Error ? err.message.slice(0, 300) : String(err);
  }
  return saveImport(run);
}

// ── The list ───────────────────────────────────────────────────────────

export type AccountPresence = Partial<Record<"app" | "sf" | "la", "yes" | "no">>;
export type AccountMatchFilter = "suggested" | "none";

export interface AccountDirQuery {
  q?: string;
  presence?: AccountPresence;
  match?: AccountMatchFilter;
  /** Only AIS Connect accounts with contacts not in Lead Alchemist yet. */
  laMissing?: boolean;
  /** The Salesforce Account Type (e.g. "Customer"), or NO_TYPE for accounts without one. */
  type?: string | null;
}

/** The "no Account Type" choice of the Type filter (same value as Mapping's). */
export const NO_ACCOUNT_TYPE = "__none__";

/** Every Account Type in AIS Connect and the Salesforce copy, for the Type filter. */
export async function accountTypesAcross(): Promise<string[]> {
  const db = await getDb();
  const result = await db.execute(sql`
    select t from (
      select sf_account_type as t from clients where sf_account_type is not null and merged_into is null
      union select type from directory_accounts where type is not null
    ) x where t <> '' order by t`);
  return rowsOf<{ t: string }>(result).map((r) => r.t);
}

export interface AccountDirRow {
  /** "a:<account id>", "s:<Salesforce Account id>" or "l:<Lead Alchemist Company id>". */
  key: string;
  name: string;
  isIndividual: boolean;
  appId: string | null;
  sfId: string | null;
  laId: string | null;
  sfName: string | null;
  sfType: string | null;
  laName: string | null;
  inApp: boolean;
  inSf: boolean;
  inLa: boolean;
  /** appNotInLa: AIS Connect contacts on the account not in Lead Alchemist yet. */
  counts: { appContacts: number; appNotInLa: number; applications: number; sfContacts: number; laContacts: number };
  /** Likely the same business in a system it isn't linked to yet. */
  suggested: {
    app: { id: string; name: string } | null;
    sf: { id: string; name: string; how: string } | null;
    la: { id: string; name: string; how: string } | null;
    /** Another AIS Connect account with the same name. */
    duplicate: { id: string; name: string } | null;
  };
}

/** Every account / Salesforce Account / Lead Alchemist Company as one row (the `enriched` CTE). */
const accountsSql = () => sql`
    with rows as (
      select 'a:' || c.id::text as key, c.id::text as app_id, c.name, c.name_key, c.is_individual,
        c.sf_account_id as sf_id, c.ghl_company_id as la_id,
        nullif(right(regexp_replace(coalesce(c.phones->>0, ''), '[^0-9]', '', 'g'), 10), '') as phone, true as in_app,
        c.sf_account_type as own_type
      from clients c where c.merged_into is null and c.deactivated_at is null
      union all
      select 's:' || d.id, null, d.name, d.name_key, false, d.id, null, d.phone, false, d.type
      from directory_accounts d
      where not exists (select 1 from clients c where c.sf_account_id = d.id and c.merged_into is null)
        and not exists (select 1 from salesforce_hidden h where h.sf_id = d.id)
      union all
      select 'l:' || d.id, null, d.name, d.name_key, false, null, d.id, d.phone, false, null
      from directory_companies d
      where not exists (select 1 from clients c where c.ghl_company_id = d.id and c.merged_into is null)
        and not exists (select 1 from lead_alchemist_hidden h where h.id = d.id)
    ),
    enriched as (
      select r.*, r.sf_id is not null as in_sf, r.la_id is not null as in_la,
        sfa.name as sf_name, coalesce(r.own_type, sfa.type) as sf_type, lac.name as la_name,
        case when r.app_id is not null then (select count(*) from contacts ct where ct.client_id = r.app_id::uuid) else 0 end as app_contacts,
        case when r.app_id is not null then (select count(*) from applications a where a.client_id = r.app_id::uuid) else 0 end as apps,
        case when r.app_id is not null then (select count(*) from contacts ct where ct.client_id = r.app_id::uuid and ct.ghl_contact_id is null) else 0 end as app_not_la,
        case when r.sf_id is not null then (select count(*) from directory_contacts dc where dc.source = 'salesforce' and dc.company_id = r.sf_id) else 0 end as sf_contacts,
        case when r.la_id is not null then (select count(*) from directory_contacts dc where dc.source = 'lead_alchemist' and dc.company_id = r.la_id) else 0 end as la_contacts,
        sug_app.id as sug_app_id, sug_app.name as sug_app_name,
        sug_sf.id as sug_sf_id, sug_sf.name as sug_sf_name, sug_sf.how as sug_sf_how,
        sug_la.id as sug_la_id, sug_la.name as sug_la_name, sug_la.how as sug_la_how,
        sug_dup.id as sug_dup_id, sug_dup.name as sug_dup_name
      from rows r
      left join directory_accounts sfa on sfa.id = r.sf_id
      left join directory_companies lac on lac.id = r.la_id
      left join lateral (
        select c.id::text as id, c.name from clients c
        where r.app_id is null and r.name_key <> '' and c.name_key = r.name_key and c.merged_into is null and c.deactivated_at is null
          and ((r.sf_id is not null and c.sf_account_id is null) or (r.la_id is not null and c.ghl_company_id is null))
          and not exists (select 1 from not_duplicates nd where nd.pair = least(r.key, 'a:' || c.id::text) || '|' || greatest(r.key, 'a:' || c.id::text))
        order by c.created_at limit 1
      ) sug_app on true
      left join lateral (
        select d.id, d.name, case when d.name_key = r.name_key then 'same name' else 'same phone' end as how from directory_accounts d
        where r.sf_id is null and ((r.name_key <> '' and d.name_key = r.name_key) or (r.phone is not null and d.phone = r.phone))
          and not exists (select 1 from clients c where c.sf_account_id = d.id and c.merged_into is null)
          and not exists (select 1 from salesforce_hidden h where h.sf_id = d.id)
          and not exists (select 1 from not_duplicates nd where nd.pair = least(r.key, 's:' || d.id) || '|' || greatest(r.key, 's:' || d.id))
        order by (d.name_key = r.name_key) desc, d.name limit 1
      ) sug_sf on true
      left join lateral (
        select d.id, d.name, case when d.name_key = r.name_key then 'same name' else 'same phone' end as how from directory_companies d
        where r.la_id is null and ((r.name_key <> '' and d.name_key = r.name_key) or (r.phone is not null and d.phone = r.phone))
          and not exists (select 1 from clients c where c.ghl_company_id = d.id and c.merged_into is null)
          and not exists (select 1 from lead_alchemist_hidden h where h.id = d.id)
          and not exists (select 1 from not_duplicates nd where nd.pair = least(r.key, 'l:' || d.id) || '|' || greatest(r.key, 'l:' || d.id))
        order by (d.name_key = r.name_key) desc, d.name limit 1
      ) sug_la on true
      left join lateral (
        -- Another AIS Connect account with the same name (not marked as a different business).
        select c.id::text as id, c.name from clients c
        where r.app_id is not null and r.name_key <> '' and c.name_key = r.name_key and c.id <> r.app_id::uuid
          and c.merged_into is null and c.deactivated_at is null and not coalesce(c.is_individual, false)
          and not exists (select 1 from not_duplicates nd where nd.pair = least(r.key, 'a:' || c.id::text) || '|' || greatest(r.key, 'a:' || c.id::text))
        order by c.created_at limit 1
      ) sug_dup on true
    )
`;

const PRESENCE_COLUMN = { app: "in_app", sf: "in_sf", la: "in_la" } as const;

function whereSql({ q, presence = {}, match, laMissing, type }: AccountDirQuery) {
  const parts = (Object.keys(PRESENCE_COLUMN) as (keyof typeof PRESENCE_COLUMN)[])
    .filter((k) => presence[k] === "yes" || presence[k] === "no")
    .map((k) => `${presence[k] === "no" ? "not " : ""}${PRESENCE_COLUMN[k]}`);
  const anySuggestion = "(sug_app_id is not null or sug_sf_id is not null or sug_la_id is not null or sug_dup_id is not null)";
  if (match === "suggested") parts.push(anySuggestion);
  if (match === "none") parts.push(`not ${anySuggestion}`);
  if (laMissing) parts.push("app_not_la > 0");
  const term = q?.trim() ? `%${q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const typeSql = !type ? sql`` : type === NO_ACCOUNT_TYPE ? sql`and nullif(p.sf_type, '') is null` : sql`and p.sf_type = ${type}`;
  return sql`${sql.raw(parts.length ? parts.join(" and ") : "true")} ${term ? sql`and lower(p.name) like ${term}` : sql``} ${typeSql}`;
}

function toRow(r: Record<string, unknown>): AccountDirRow {
  const n = (v: unknown) => Number(v ?? 0);
  return {
    key: r.key as string,
    name: (r.name as string) || "Unnamed",
    isIndividual: !!r.is_individual,
    appId: (r.app_id as string) ?? null,
    sfId: (r.sf_id as string) ?? null,
    laId: (r.la_id as string) ?? null,
    sfName: (r.sf_name as string) ?? null,
    sfType: (r.sf_type as string) ?? null,
    laName: (r.la_name as string) ?? null,
    inApp: !!r.in_app,
    inSf: !!r.in_sf,
    inLa: !!r.in_la,
    counts: { appContacts: n(r.app_contacts), appNotInLa: n(r.app_not_la), applications: n(r.apps), sfContacts: n(r.sf_contacts), laContacts: n(r.la_contacts) },
    suggested: {
      app: r.sug_app_id ? { id: r.sug_app_id as string, name: r.sug_app_name as string } : null,
      sf: r.sug_sf_id ? { id: r.sug_sf_id as string, name: r.sug_sf_name as string, how: r.sug_sf_how as string } : null,
      la: r.sug_la_id ? { id: r.sug_la_id as string, name: r.sug_la_name as string, how: r.sug_la_how as string } : null,
      duplicate: r.sug_dup_id ? { id: r.sug_dup_id as string, name: r.sug_dup_name as string } : null,
    },
  };
}

export async function listAccountDirectory({ limit = 50, offset = 0, ...query }: AccountDirQuery & { limit?: number; offset?: number }) {
  const db = await getDb();
  const result = await db.execute(sql`
    ${accountsSql()}
    select p.*, count(*) over () as total from enriched p
    where ${whereSql(query)}
    order by lower(p.name), p.key
    limit ${Math.min(limit, 200)} offset ${offset}`);
  const raw = rowsOf<Record<string, unknown>>(result);
  let total = Number(raw[0]?.total ?? 0);
  if (!raw.length && offset > 0) total = (await accountDirectoryKeys(query)).length;
  return { rows: raw.map(toRow), total };
}

/** Every row key for these filters (all pages), for "select all matching". */
export async function accountDirectoryKeys(query: AccountDirQuery): Promise<string[]> {
  const db = await getDb();
  const result = await db.execute(sql`
    ${accountsSql()}
    select p.key from enriched p where ${whereSql(query)} order by lower(p.name), p.key`);
  return rowsOf<{ key: string }>(result).map((r) => r.key);
}

/** How many rows are in each combination of AIS Connect, Salesforce and Lead Alchemist, plus how many have a suggested match. */
export async function accountBreakdown(q?: string, type?: string | null) {
  const db = await getDb();
  const result = await db.execute(sql`
    ${accountsSql()}
    select in_app, in_sf, in_la, count(*) as n,
      count(*) filter (where sug_app_id is not null or sug_sf_id is not null or sug_la_id is not null or sug_dup_id is not null) as suggested,
      count(*) filter (where app_not_la > 0) as la_missing, coalesce(sum(app_not_la), 0) as la_missing_contacts
    from enriched p where ${whereSql({ q, type })}
    group by in_app, in_sf, in_la`);
  const rows = rowsOf<{ in_app: boolean; in_sf: boolean; in_la: boolean; n: number | string; suggested: number | string; la_missing: number | string; la_missing_contacts: number | string }>(result);
  return {
    combos: rows.map((r) => ({ app: !!r.in_app, sf: !!r.in_sf, la: !!r.in_la, count: Number(r.n) })),
    total: rows.reduce((t, r) => t + Number(r.n), 0),
    suggested: rows.reduce((t, r) => t + Number(r.suggested), 0),
    /** AIS Connect accounts with contacts not in Lead Alchemist yet, and how many contacts. */
    laMissing: rows.reduce((t, r) => t + Number(r.la_missing), 0),
    laMissingContacts: rows.reduce((t, r) => t + Number(r.la_missing_contacts), 0),
  };
}

async function rowsByKeys(keys: string[]): Promise<AccountDirRow[]> {
  if (!keys.length) return [];
  const db = await getDb();
  const list = JSON.stringify(keys.slice(0, 200));
  const result = await db.execute(sql`
    ${accountsSql()}
    select p.* from enriched p where p.key in (select jsonb_array_elements_text(${list}::jsonb))`);
  return rowsOf<Record<string, unknown>>(result).map(toRow);
}

// ── Sync actions (bulk; each takes row keys) ─────────────────────────────

export interface AccountSyncDeps {
  sf: SalesforceApi | null;
  links: Links;
}

export interface AccountSyncOptions {
  /** Link to the suggested match instead of creating a new account / Company / Salesforce Account. */
  useSuggested?: boolean;
  /** Lead Alchemist: also create contacts with no match there. */
  createMissing?: boolean;
  timeBudgetMs?: number;
}

const needSf = (deps: AccountSyncDeps) => {
  if (!deps.sf) throw new Error("Salesforce isn't connected. Add the keys in Settings → Integrations.");
  return deps.sf;
};

function budget(opts: AccountSyncOptions) {
  const started = Date.now();
  return () => Date.now() - started > (opts.timeBudgetMs ?? 40_000);
}

function finish(result: BulkResult, left: number, skipped: Record<string, number>) {
  for (const [why, n] of Object.entries(skipped)) if (n) result.notes.push(`${n} skipped: ${why}.`);
  if (left > 0) result.notes.unshift(`${left} weren't reached in this run (time limit per click): click again to do the rest.`);
  return result;
}

/** Link an account to its suggested Lead Alchemist Company (AIS Connect only; nothing changes in Lead Alchemist). */
async function linkSuggestedCompany(accountId: string, companyId: string, actor: string, result: BulkResult) {
  const r = await linkCompaniesToAccounts([{ businessId: companyId, accountId }], actor);
  result.notes.push(...r.notes);
  return r.done > 0;
}

/**
 * "Add to AIS Connect": a Salesforce Account comes in with its Contacts; a Lead Alchemist Company
 * becomes a new account. With useSuggested, either joins the AIS Connect account suggested for it
 * instead, and a Salesforce Account's suggested Company is linked to its account too.
 */
export async function addAccountsToApp(keys: string[], actor: string, deps: AccountSyncDeps, opts: AccountSyncOptions = {}): Promise<BulkResult> {
  const result: BulkResult = { done: 0, notes: [] };
  const over = budget(opts);
  const rows = await rowsByKeys(keys);
  const skipped: Record<string, number> = {};
  let left = rows.length;
  for (const r of rows) {
    if (over()) break;
    left--;
    if (r.inApp) {
      result.done++; // already in AIS Connect
      continue;
    }
    try {
      if (r.sfId) {
        const sf = needSf(deps);
        if (opts.useSuggested && r.suggested.app) await relinkSalesforceAccount(r.suggested.app.id, r.sfId, sf, actor);
        const { clientId } = await syncAccount(r.sfId, { sf, links: deps.links, writeLinks: false }, actor);
        if (opts.useSuggested && r.suggested.la) await linkSuggestedCompany(clientId, r.suggested.la.id, actor, result);
      } else if (r.laId) {
        if (opts.useSuggested && r.suggested.app) {
          if (!(await linkSuggestedCompany(r.suggested.app.id, r.laId, actor, result))) continue;
        } else {
          const added = await addCompaniesToApp([r.laId], actor);
          result.notes.push(...added.notes);
          if (!added.done) continue;
        }
      }
      result.done++;
    } catch (err) {
      result.notes.push(`${r.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return finish(result, left, skipped);
}

/**
 * Sync AIS Connect accounts to Lead Alchemist: their Company (the linked one, the suggested one with
 * useSuggested, one with the same name, else a new one) and their contacts in it.
 */
export async function accountsToLeadAlchemist(keys: string[], actor: string, deps: AccountSyncDeps, opts: AccountSyncOptions = {}): Promise<BulkResult> {
  const result: BulkResult = { done: 0, notes: [] };
  const rows = await rowsByKeys(keys);
  const skipped = { "not in AIS Connect yet (add it first)": 0 };
  const ids: string[] = [];
  for (const r of rows) {
    if (!r.appId) {
      skipped["not in AIS Connect yet (add it first)"]++;
      continue;
    }
    if (opts.useSuggested && !r.laId && r.suggested.la) await linkSuggestedCompany(r.appId, r.suggested.la.id, actor, result);
    ids.push(r.appId);
  }
  if (ids.length) {
    const r = await syncAccountsToLeadAlchemist(ids, actor, deps, { createMissing: opts.createMissing, timeBudgetMs: opts.timeBudgetMs });
    result.done += r.done;
    result.notes.push(...r.notes);
    result.contacts = r.contacts;
  }
  return finish(result, 0, skipped);
}

/**
 * Link or create AIS Connect accounts in Salesforce (with their contacts under them): the suggested
 * Salesforce Account with useSuggested, else one with the same name, else a new one.
 */
export async function accountsToSalesforce(keys: string[], actor: string, deps: AccountSyncDeps, opts: AccountSyncOptions = {}): Promise<BulkResult> {
  const sf = needSf(deps);
  const result: BulkResult = { done: 0, notes: [] };
  const rows = await rowsByKeys(keys);
  const skipped = { "not in AIS Connect yet (add it first)": 0 };
  const ids: string[] = [];
  for (const r of rows) {
    if (!r.appId) {
      skipped["not in AIS Connect yet (add it first)"]++;
      continue;
    }
    if (opts.useSuggested && !r.sfId && r.suggested.sf) {
      try {
        await relinkSalesforceAccount(r.appId, r.suggested.sf.id, sf, actor);
      } catch (err) {
        result.notes.push(`${r.name}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    ids.push(r.appId);
  }
  if (ids.length) {
    const r = await createAccountsInSalesforce(ids, actor, { sf, links: deps.links });
    result.done += r.done;
    result.notes.push(...r.notes);
  }
  return finish(result, 0, skipped);
}

/** Link each row to its suggested matches only (AIS Connect's links; nothing is created anywhere). */
export async function linkSuggestedMatches(keys: string[], actor: string, deps: AccountSyncDeps, opts: AccountSyncOptions = {}): Promise<BulkResult> {
  const result: BulkResult = { done: 0, notes: [] };
  const over = budget(opts);
  const rows = await rowsByKeys(keys);
  const skipped = { "no suggested match": 0 };
  let left = rows.length;
  for (const r of rows) {
    if (over()) break;
    left--;
    let linked = false;
    try {
      const accountId = r.appId ?? r.suggested.app?.id ?? null;
      if (!accountId) {
        skipped["no suggested match"]++;
        continue;
      }
      if (!r.appId && r.sfId) {
        await relinkSalesforceAccount(accountId, r.sfId, needSf(deps), actor);
        linked = true;
      }
      if (!r.appId && r.laId) linked = (await linkSuggestedCompany(accountId, r.laId, actor, result)) || linked;
      if (!r.sfId && r.suggested.sf) {
        await relinkSalesforceAccount(accountId, r.suggested.sf.id, needSf(deps), actor);
        linked = true;
      }
      if (!r.laId && r.suggested.la) linked = (await linkSuggestedCompany(accountId, r.suggested.la.id, actor, result)) || linked;
    } catch (err) {
      result.notes.push(`${r.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (linked) result.done++;
    else if (!r.suggested.app && !r.suggested.sf && !r.suggested.la) skipped["no suggested match"]++;
  }
  return finish(result, left, skipped);
}
