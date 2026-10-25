import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Client } from "@/lib/db/schema";
import { addClientEvent, createAccount, getClient, mergeClients, refreshSearch, setClientSalesforce } from "@/lib/clients/repo";
import { nameKey, phoneDigits } from "@/lib/clients/text";
import { addContactsToBusiness, getBusiness, updateBusiness } from "@/lib/ghl/client";
import type { Links } from "@/lib/integrations/urls";
import type { SalesforceApi } from "@/lib/salesforce/api";
import { soqlString } from "@/lib/salesforce/api";
import { visibleFields } from "@/lib/salesforce/fields";
import { hide, unhide } from "@/lib/salesforce/hidden";
import { syncAccount } from "@/lib/salesforce/manager";
import { prepareFields } from "@/lib/salesforce/mapping";

/**
 * Merge records that are the same business, picking what stays (Accounts → Compare & merge).
 * Up to four rows from "Across all three" (AIS Connect accounts, Salesforce Accounts, Lead
 * Alchemist Companies), plus the Salesforce Account / Company each selected account is linked to.
 * Staff pick, per system, the record that stays and, per field, the value that stays. Then:
 * - AIS Connect: the accounts become one (contacts, applications and history move to the kept one);
 * - Salesforce: the kept Account is linked; any other is hidden in AIS Connect (it stays in
 *   Salesforce: merge it there, which keeps its history);
 * - Lead Alchemist: the kept Company is linked and the other Companies' contacts are moved into
 *   it; the others are hidden in AIS Connect (they stay in Lead Alchemist).
 * Nothing is deleted anywhere. The chosen details can also be written to the kept Salesforce
 * Account and Company.
 */
export const MERGE_FIELDS = ["name", "phone", "email", "website", "street", "city", "state", "postalCode"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export const FIELD_LABELS: Record<MergeField, string> = {
  name: "Name",
  phone: "Phone",
  email: "Email",
  website: "Website",
  street: "Street",
  city: "City",
  state: "State",
  postalCode: "ZIP",
};

export type MergeSystem = "app" | "sf" | "la";

export interface MergeRecord {
  key: string;
  system: MergeSystem;
  id: string;
  name: string;
  values: Partial<Record<MergeField, string>>;
  /** e.g. "3 contacts · 2 applications". */
  detail: string;
  /** Linked to (or the link of) a selected AIS Connect account. */
  linkedTo: string | null;
}

const KEY = /^([asl]):([A-Za-z0-9-]{3,64})$/;
const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function parseMergeKeys(raw: string[]) {
  return [...new Set(raw)].filter((k) => KEY.test(k)).slice(0, 4);
}

async function counts(clientId: string) {
  const db = await getDb();
  const [people, apps] = await Promise.all([
    db.$count(schema.contacts, eq(schema.contacts.clientId, clientId)),
    db.$count(schema.applications, eq(schema.applications.clientId, clientId)),
  ]);
  return { people, apps };
}

async function directoryCount(source: "salesforce" | "lead_alchemist", companyId: string) {
  const db = await getDb();
  return db.$count(schema.directoryContacts, and(eq(schema.directoryContacts.source, source), eq(schema.directoryContacts.companyId, companyId)));
}

function appValues(c: Client): Partial<Record<MergeField, string>> {
  return {
    name: clean(c.name),
    phone: clean(c.phones[0]),
    email: clean(c.primaryEmail),
    website: clean(c.website),
    street: clean(c.address?.street),
    city: clean(c.address?.city),
    state: clean(c.address?.state),
    postalCode: clean(c.address?.postalCode),
  };
}

/** The records to compare: the selected rows plus what their accounts are linked to. */
export async function loadMergeRecords(keys: string[], deps: { sf: SalesforceApi | null; laConnected: boolean }): Promise<MergeRecord[]> {
  const db = await getDb();
  const out: MergeRecord[] = [];
  const sfIds = new Map<string, string | null>();
  const laIds = new Map<string, string | null>();
  for (const key of parseMergeKeys(keys)) {
    const [, kind, id] = key.match(KEY)!;
    if (kind === "a") {
      const c = await getClient(id);
      if (!c || c.mergedInto) continue;
      const n = await counts(c.id);
      out.push({ key, system: "app", id: c.id, name: c.name, values: appValues(c), detail: `${plural(n.people, "contact")} · ${plural(n.apps, "application")}`, linkedTo: null });
      if (c.sfAccountId && !sfIds.has(c.sfAccountId)) sfIds.set(c.sfAccountId, c.name);
      if (c.ghlCompanyId && !laIds.has(c.ghlCompanyId)) laIds.set(c.ghlCompanyId, c.name);
    } else if (kind === "s") sfIds.set(id, sfIds.get(id) ?? null);
    else laIds.set(id, laIds.get(id) ?? null);
  }

  if (sfIds.size) {
    const ids = [...sfIds.keys()];
    const copies = await db.select().from(schema.directoryAccounts).where(inArray(schema.directoryAccounts.id, ids));
    let live: Record<string, unknown>[] = [];
    if (deps.sf) {
      const fields = await visibleFields(deps.sf, "Account", ["Phone", "Website", "BillingStreet", "BillingCity", "BillingState", "BillingPostalCode"]);
      live = await deps.sf
        .query<Record<string, unknown>>(`SELECT ${["Id", "Name", ...fields].join(", ")} FROM Account WHERE Id IN (${ids.map(soqlString).join(", ")})`)
        .catch(() => []);
    }
    for (const id of ids) {
      const l = live.find((r) => r.Id === id);
      const c = copies.find((r) => r.id === id);
      if (!l && !c) continue;
      out.push({
        key: `s:${id}`,
        system: "sf",
        id,
        name: String(l?.Name ?? c?.name ?? id),
        values: {
          name: clean(l?.Name ?? c?.name),
          phone: clean(l?.Phone ?? c?.phone),
          website: clean(l?.Website ?? c?.website),
          street: clean(l?.BillingStreet),
          city: clean(l?.BillingCity),
          state: clean(l?.BillingState),
          postalCode: clean(l?.BillingPostalCode),
        },
        detail: `${plural(await directoryCount("salesforce", id), "contact")}${c?.type ? ` · ${c.type}` : ""}`,
        linkedTo: sfIds.get(id) ?? null,
      });
    }
  }

  for (const [id, linkedTo] of laIds) {
    const [copy] = await db.select().from(schema.directoryCompanies).where(eq(schema.directoryCompanies.id, id)).limit(1);
    const live = deps.laConnected ? await getBusiness(id).catch(() => null) : null;
    if (!copy && !live) continue;
    out.push({
      key: `l:${id}`,
      system: "la",
      id,
      name: live?.name ?? copy?.name ?? id,
      values: {
        name: clean(live?.name ?? copy?.name),
        phone: clean(live?.phone ?? copy?.phone),
        email: clean(live?.email),
        website: clean(live?.website ?? copy?.website),
        street: clean(live?.address),
        city: clean(live?.city),
        state: clean(live?.state),
        postalCode: clean(live?.postalCode),
      },
      detail: plural(await directoryCount("lead_alchemist", id), "contact"),
      linkedTo,
    });
  }
  return out;
}

export interface MergeChoice {
  keys: string[];
  /** The record that stays in each system ("" or null: none chosen / none there). */
  keepApp: string | null;
  keepSf: string | null;
  keepLa: string | null;
  values: Partial<Record<MergeField, string>>;
  /** Also write the chosen details to the kept Salesforce Account / Lead Alchemist Company. */
  writeSf: boolean;
  writeLa: boolean;
}

export async function mergeAccounts(choice: MergeChoice, actor: string, deps: { sf: SalesforceApi | null; links: Links; laConnected: boolean }) {
  const records = await loadMergeRecords(choice.keys, deps);
  const of = (system: MergeSystem) => records.filter((r) => r.system === system);
  const pick = (system: MergeSystem, id: string | null) => {
    const list = of(system);
    if (!list.length) return null;
    const kept = list.find((r) => r.id === id) ?? (list.length === 1 ? list[0] : null);
    if (!kept) throw new Error(`Choose which ${system === "app" ? "AIS Connect account" : system === "sf" ? "Salesforce Account" : "Lead Alchemist Company"} stays.`);
    return kept;
  };
  if (records.length < 2) throw new Error("Choose at least two records to merge.");
  const keepApp = pick("app", choice.keepApp);
  const keepSf = pick("sf", choice.keepSf);
  const keepLa = pick("la", choice.keepLa);
  const notes: string[] = [];
  const db = await getDb();
  const appIds = of("app").map((r) => r.id);

  // The kept Salesforce Account / Company mustn't belong to an account outside this merge.
  if (keepSf) {
    const [other] = await db
      .select({ name: schema.clients.name })
      .from(schema.clients)
      .where(and(eq(schema.clients.sfAccountId, keepSf.id), isNull(schema.clients.mergedInto), sql`${schema.clients.id} not in (${sql.join(appIds.length ? appIds.map((i) => sql`${i}::uuid`) : [sql`null`], sql`, `)})`))
      .limit(1);
    if (other) throw new Error(`That Salesforce Account is linked to "${other.name}" in AIS Connect. Include that account in the merge.`);
  }
  if (keepLa) {
    const [other] = await db
      .select({ name: schema.clients.name })
      .from(schema.clients)
      .where(and(eq(schema.clients.ghlCompanyId, keepLa.id), isNull(schema.clients.mergedInto), sql`${schema.clients.id} not in (${sql.join(appIds.length ? appIds.map((i) => sql`${i}::uuid`) : [sql`null`], sql`, `)})`))
      .limit(1);
    if (other) throw new Error(`That Lead Alchemist Company is linked to "${other.name}" in AIS Connect. Include that account in the merge.`);
  }

  // 1. The AIS Connect account that stays: the chosen one, else one brought in from Salesforce / the Company, else a new one.
  let targetId: string;
  if (keepApp) targetId = keepApp.id;
  else if (keepSf && deps.sf) targetId = (await syncAccount(keepSf.id, { sf: deps.sf, links: deps.links, writeLinks: false }, actor)).clientId;
  else {
    const v = choice.values;
    const account = await createAccount(
      { name: v.name || keepSf?.name || keepLa?.name || "Unnamed", phone: v.phone, primaryEmail: v.email, website: v.website, address: { street: v.street, city: v.city, state: v.state, postalCode: v.postalCode }, source: keepLa ? "lead_alchemist" : "manual" },
      actor,
    );
    targetId = account.id;
  }

  // 2. Links that won't stay come off first (merging refuses two different links), then the others merge in.
  for (const id of new Set([targetId, ...appIds])) {
    const c = await getClient(id);
    if (!c) continue;
    const patch: Parameters<typeof setClientSalesforce>[1] = {};
    if (c.sfAccountId && c.sfAccountId !== keepSf?.id) patch.sfAccountId = null;
    if (c.ghlCompanyId && c.ghlCompanyId !== keepLa?.id) patch.ghlCompanyId = null;
    if (Object.keys(patch).length) await setClientSalesforce(id, patch);
  }
  for (const id of appIds) if (id !== targetId) await mergeClients(targetId, id, actor);

  // 3. Link the kept Salesforce Account and Company.
  const patch: Parameters<typeof setClientSalesforce>[1] = {};
  if (keepSf) {
    patch.sfAccountId = keepSf.id;
    patch.sfStatus = "linked";
    await unhide([keepSf.id]);
  }
  if (keepLa) {
    patch.ghlCompanyId = keepLa.id;
    await db.delete(schema.leadAlchemistHidden).where(eq(schema.leadAlchemistHidden.id, keepLa.id));
  }
  if (Object.keys(patch).length) await setClientSalesforce(targetId, patch);

  // 4. The chosen details on the kept account.
  const target = (await getClient(targetId))!;
  const v = choice.values;
  const name = v.name?.trim() || target.name;
  const phones = v.phone ? [v.phone, ...target.phones.filter((p) => phoneDigits(p) !== phoneDigits(v.phone))].slice(0, 5) : target.phones;
  await db
    .update(schema.clients)
    .set({
      name,
      nameKey: nameKey(name),
      phones,
      primaryEmail: v.email ?? target.primaryEmail,
      website: v.website ?? target.website,
      address: { street: v.street ?? target.address?.street, city: v.city ?? target.address?.city, state: v.state ?? target.address?.state, postalCode: v.postalCode ?? target.address?.postalCode },
      possibleDuplicateOf: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.clients.id, targetId));
  await refreshSearch(targetId);

  // 5. Other Salesforce Accounts: hidden here; they stay in Salesforce.
  for (const r of of("sf")) {
    if (r.id === keepSf?.id) continue;
    await hide(r.id, "account", r.name, actor);
    notes.push(`Salesforce Account "${r.name}" (${r.id}) is hidden in AIS Connect but still in Salesforce: merge it into "${keepSf?.name}" there to combine its history.`);
  }
  // 6. Other Companies: their contacts move to the kept Company; then hidden here (they stay in Lead Alchemist).
  for (const r of of("la")) {
    if (r.id === keepLa?.id) continue;
    if (keepLa) {
      const people = await db
        .select({ id: schema.directoryContacts.externalId })
        .from(schema.directoryContacts)
        .where(and(eq(schema.directoryContacts.source, "lead_alchemist"), eq(schema.directoryContacts.companyId, r.id)));
      try {
        if (people.length) {
          await addContactsToBusiness(
            people.map((p) => p.id),
            keepLa.id,
          );
          await db
            .update(schema.directoryContacts)
            .set({ companyId: keepLa.id, companyName: keepLa.name, companyKey: nameKey(keepLa.name) })
            .where(and(eq(schema.directoryContacts.source, "lead_alchemist"), eq(schema.directoryContacts.companyId, r.id)));
        }
        notes.push(`Moved ${plural(people.length, "contact")} from Lead Alchemist Company "${r.name}" to "${keepLa.name}".`);
      } catch (err) {
        notes.push(`Couldn't move the contacts of Lead Alchemist Company "${r.name}": ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    await db
      .insert(schema.leadAlchemistHidden)
      .values({ id: r.id, name: r.name, keptId: keepLa?.id ?? null, hiddenBy: actor })
      .onConflictDoUpdate({ target: schema.leadAlchemistHidden.id, set: { keptId: keepLa?.id ?? null, hiddenBy: actor, hiddenAt: new Date() } });
    notes.push(`Lead Alchemist Company "${r.name}" is hidden in AIS Connect but still in Lead Alchemist (nothing is deleted there).`);
  }

  // 7. Optionally, the chosen details on the kept Salesforce Account and Company.
  if (choice.writeSf && keepSf && deps.sf) {
    try {
      const { data } = prepareFields(
        await deps.sf.describe("Account"),
        { Name: name, Phone: v.phone, Website: v.website, BillingStreet: v.street, BillingCity: v.city, BillingState: v.state, BillingPostalCode: v.postalCode },
        "update",
      );
      if (Object.keys(data).length) await deps.sf.update("Account", keepSf.id, data);
    } catch (err) {
      notes.push(`Couldn't update the Salesforce Account: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (choice.writeLa && keepLa && deps.laConnected) {
    try {
      await updateBusiness(keepLa.id, { name, phone: v.phone, email: v.email, website: v.website, address: v.street, city: v.city, state: v.state, postalCode: v.postalCode });
    } catch (err) {
      notes.push(`Couldn't update the Lead Alchemist Company: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await addClientEvent(targetId, "merged", actor, {
    message: `Merged ${records.length} records into this account (${records.map((r) => `${r.system === "app" ? "AIS Connect" : r.system === "sf" ? "Salesforce" : "Lead Alchemist"} "${r.name}"`).join(", ")})`,
    data: { keys: records.map((r) => r.key), keepSf: keepSf?.id ?? null, keepLa: keepLa?.id ?? null },
  });
  return { clientId: targetId, records: records.length, notes };
}

/** "Not the same business": these rows aren't suggested as a match for each other again. */
export async function markNotDuplicates(keys: string[], actor: string) {
  const list = parseMergeKeys(keys);
  const db = await getDb();
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const pair = [list[i], list[j]].sort().join("|");
      await db.insert(schema.notDuplicates).values({ pair, decidedBy: actor }).onConflictDoNothing();
    }
  return list.length;
}
