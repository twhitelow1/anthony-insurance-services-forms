import "server-only";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { businessDomain, phoneDigits, websiteDomain } from "@/lib/clients/text";

/**
 * Accounts → Duplicates: AIS Connect accounts that are probably the same business, in groups,
 * with why (same name, email, phone, website or business email domain, or flagged when it came
 * in). Pairs staff marked "Not the same business" are left out. Read only; merging is done on
 * the Compare & merge screen.
 */
export type DuplicateReason = "same name" | "same email" | "same phone" | "same website" | "same email domain" | "flagged when created";

export interface DuplicateAccount {
  id: string;
  name: string;
  isIndividual: boolean;
  email: string | null;
  phone: string | null;
  website: string | null;
  sfAccountId: string | null;
  ghlCompanyId: string | null;
  contacts: number;
  applications: number;
  createdAt: Date;
}

export interface DuplicateGroup {
  accounts: DuplicateAccount[];
  reasons: DuplicateReason[];
}

/** A value shared by more accounts than this (an office line, a franchise domain) says nothing. */
const MAX_SHARED = 5;
const STRONG: DuplicateReason[] = ["same name", "same email", "same phone", "same website", "flagged when created"];

export async function findDuplicateGroups(opts: { q?: string; reason?: DuplicateReason | "" } = {}): Promise<DuplicateGroup[]> {
  const db = await getDb();
  const c = schema.clients;
  const all = await db
    .select({
      id: c.id,
      name: c.name,
      nameKey: c.nameKey,
      isIndividual: c.isIndividual,
      email: c.primaryEmail,
      phones: c.phones,
      website: c.website,
      possibleDuplicateOf: c.possibleDuplicateOf,
      sfAccountId: c.sfAccountId,
      ghlCompanyId: c.ghlCompanyId,
      createdAt: c.createdAt,
    })
    .from(c)
    .where(and(isNull(c.mergedInto), isNull(c.deactivatedAt)));
  const byId = new Map(all.map((a) => [a.id, a]));

  // Buckets of accounts sharing a value; each bucket of 2..MAX_SHARED links its accounts.
  const buckets = new Map<string, { reason: DuplicateReason; ids: string[] }>();
  const add = (reason: DuplicateReason, value: string | null | undefined, id: string) => {
    if (!value) return;
    const k = `${reason}|${value}`;
    const b = buckets.get(k) ?? { reason, ids: [] };
    if (!b.ids.includes(id)) b.ids.push(id);
    buckets.set(k, b);
  };
  for (const a of all) {
    if (!a.isIndividual && a.nameKey) add("same name", a.nameKey, a.id);
    add("same email", a.email?.trim().toLowerCase(), a.id);
    for (const p of a.phones) {
      const d = phoneDigits(p);
      if (d.length >= 10) add("same phone", d.slice(-10), a.id);
    }
    add("same website", websiteDomain(a.website), a.id);
    if (!a.isIndividual) add("same email domain", businessDomain(a.email), a.id);
  }

  const notPairs = new Set((await db.select({ pair: schema.notDuplicates.pair }).from(schema.notDuplicates)).map((r) => r.pair));
  const pairKey = (x: string, y: string) => [`a:${x}`, `a:${y}`].sort().join("|");
  const links = new Map<string, Set<DuplicateReason>>();
  const link = (x: string, y: string, reason: DuplicateReason) => {
    if (x === y || notPairs.has(pairKey(x, y))) return;
    const k = [x, y].sort().join("|");
    links.set(k, (links.get(k) ?? new Set()).add(reason));
  };
  for (const b of buckets.values()) {
    if (b.ids.length < 2 || b.ids.length > MAX_SHARED) continue;
    for (let i = 0; i < b.ids.length; i++) for (let j = i + 1; j < b.ids.length; j++) link(b.ids[i], b.ids[j], b.reason);
  }
  for (const a of all) if (a.possibleDuplicateOf && byId.has(a.possibleDuplicateOf)) link(a.id, a.possibleDuplicateOf, "flagged when created");

  // Groups: accounts joined by any link (union-find).
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const k of links.keys()) {
    const [x, y] = k.split("|");
    parent.set(find(x), find(y));
  }
  const groups = new Map<string, { ids: Set<string>; reasons: Set<DuplicateReason> }>();
  for (const [k, reasons] of links) {
    const [x] = k.split("|");
    const root = find(x);
    const g = groups.get(root) ?? { ids: new Set(), reasons: new Set() };
    for (const id of k.split("|")) g.ids.add(id);
    for (const r of reasons) g.reasons.add(r);
    groups.set(root, g);
  }

  let list = [...groups.values()].map((g) => ({ ids: [...g.ids], reasons: [...g.reasons] }));
  // "Same email domain" alone is weak: only shown when that's what's asked for.
  list = opts.reason ? list.filter((g) => g.reasons.includes(opts.reason as DuplicateReason)) : list.filter((g) => g.reasons.some((r) => STRONG.includes(r)));
  const term = opts.q?.trim().toLowerCase();
  if (term) list = list.filter((g) => g.ids.some((id) => byId.get(id)!.name.toLowerCase().includes(term)));

  const shownIds = list.flatMap((g) => g.ids);
  const counts = new Map<string, { contacts: number; applications: number }>();
  if (shownIds.length) {
    const rows = await db
      .select({
        id: c.id,
        contacts: sql<number>`(select count(*) from ${schema.contacts} ct where ct.client_id = ${sql.raw(`"clients"."id"`)})`.mapWith(Number),
        applications: sql<number>`(select count(*) from ${schema.applications} ap where ap.client_id = ${sql.raw(`"clients"."id"`)})`.mapWith(Number),
      })
      .from(c)
      .where(inArray(c.id, shownIds));
    for (const r of rows) counts.set(r.id, { contacts: r.contacts, applications: r.applications });
  }

  return list
    .map((g) => ({
      reasons: STRONG.concat("same email domain").filter((r) => g.reasons.includes(r)),
      accounts: g.ids
        .map((id) => {
          const a = byId.get(id)!;
          return {
            id: a.id,
            name: a.name,
            isIndividual: a.isIndividual,
            email: a.email,
            phone: a.phones[0] ?? null,
            website: a.website,
            sfAccountId: a.sfAccountId,
            ghlCompanyId: a.ghlCompanyId,
            contacts: counts.get(id)?.contacts ?? 0,
            applications: counts.get(id)?.applications ?? 0,
            createdAt: a.createdAt,
          };
        })
        // Most used first: usually the one to keep.
        .sort((x, y) => y.applications - x.applications || y.contacts - x.contacts || x.createdAt.getTime() - y.createdAt.getTime()),
    }))
    .sort((x, y) => x.accounts[0].name.localeCompare(y.accounts[0].name));
}
