import "server-only";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { ContactChangeRow } from "@/lib/db/schema";

/**
 * The per-person change log: what each sync changed or saw, field by field, with when and who.
 * Written by the syncs (Salesforce reads, Lead Alchemist reads and writes, tier changes); shown
 * under each contact on the account page and in Settings → Tools → Change log.
 */
export interface ChangeEntry {
  system: ContactChangeRow["system"];
  direction: ContactChangeRow["direction"];
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
}

const clip = (v: string | null | undefined) => (v === undefined || v === null ? null : String(v).slice(0, 500));

export async function recordContactChanges(contactId: string, clientId: string | null, entries: ChangeEntry[], actor: string) {
  const rows = entries
    .filter((e) => (e.oldValue ?? null) !== (e.newValue ?? null))
    .map((e) => ({ contactId, clientId, system: e.system, direction: e.direction, field: e.field.slice(0, 80), oldValue: clip(e.oldValue), newValue: clip(e.newValue), actor }));
  if (!rows.length) return;
  const db = await getDb();
  await db.insert(schema.contactChanges).values(rows);
}

/** The latest changes for each of these people (newest first). */
export async function changesForContacts(contactIds: string[], perContact = 20): Promise<Map<string, ContactChangeRow[]>> {
  const out = new Map<string, ContactChangeRow[]>();
  if (!contactIds.length) return out;
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.contactChanges)
    .where(inArray(schema.contactChanges.contactId, contactIds))
    .orderBy(desc(schema.contactChanges.createdAt), desc(schema.contactChanges.id))
    .limit(perContact * contactIds.length);
  for (const r of rows) {
    const list = out.get(r.contactId) ?? [];
    if (list.length < perContact) list.push(r);
    out.set(r.contactId, list);
  }
  return out;
}

/** Every change, newest first, for Settings → Tools → Change log. */
export async function listContactChanges({ q, system, limit = 50, offset = 0 }: { q?: string; system?: ContactChangeRow["system"]; limit?: number; offset?: number }) {
  const db = await getDb();
  const c = schema.contactChanges;
  const p = schema.contacts;
  const term = q?.trim() ? `%${q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const where: SQL | undefined = and(
    system ? eq(c.system, system) : undefined,
    term ? or(ilike(p.name, term), ilike(c.field, term), ilike(c.newValue, term), ilike(c.oldValue, term)) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ change: c, name: p.name, clientId: p.clientId })
      .from(c)
      .innerJoin(p, eq(p.id, c.contactId))
      .where(where)
      .orderBy(desc(c.createdAt), desc(c.id))
      .limit(Math.min(limit, 200))
      .offset(offset),
    db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(c).innerJoin(p, eq(p.id, c.contactId)).where(where),
  ]);
  return { rows, total };
}
