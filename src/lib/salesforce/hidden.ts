import "server-only";
import { inArray, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/** Salesforce records removed from this dashboard (they stay in Salesforce). */
export async function isHidden(sfId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select({ id: schema.salesforceHidden.sfId }).from(schema.salesforceHidden).where(eq(schema.salesforceHidden.sfId, sfId)).limit(1);
  return !!row;
}

export async function hiddenSet(sfIds: string[]): Promise<Set<string>> {
  if (!sfIds.length) return new Set();
  const db = await getDb();
  const rows = await db.select({ id: schema.salesforceHidden.sfId }).from(schema.salesforceHidden).where(inArray(schema.salesforceHidden.sfId, sfIds));
  return new Set(rows.map((r) => r.id));
}

export async function hide(sfId: string, kind: "account" | "contact", name: string, actor: string) {
  const db = await getDb();
  await db
    .insert(schema.salesforceHidden)
    .values({ sfId, kind, name, removedBy: actor })
    .onConflictDoUpdate({ target: schema.salesforceHidden.sfId, set: { name, removedBy: actor, removedAt: new Date() } });
}

export async function unhide(sfIds: string[]) {
  if (!sfIds.length) return;
  const db = await getDb();
  await db.delete(schema.salesforceHidden).where(inArray(schema.salesforceHidden.sfId, sfIds));
}
