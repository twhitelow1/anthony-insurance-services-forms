import "server-only";
import { and, asc, count, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Contact } from "@/lib/db/schema";
import { exactMatch, laCandidates, laName } from "@/lib/ghl/match";

/**
 * "Find Lead Alchemist matches": for every contact not linked to Lead Alchemist yet, look up
 * Lead Alchemist by email and phone (its own duplicate lookup) and remember the one exact match
 * as a suggestion. Reads Lead Alchemist only; nothing is linked until staff choose to. Runs in
 * time-boxed batches (the Mapping page keeps calling while it's open) and picks up where it
 * stopped, so it can be paused and resumed.
 */
const BATCH = 25;

const unlinked = () => isNull(schema.contacts.ghlContactId);

export async function laMatchProgress() {
  const db = await getDb();
  const ct = schema.contacts;
  const [[{ total }], [{ checked }], [{ suggested }], [{ several }]] = await Promise.all([
    db.select({ total: count() }).from(ct).where(unlinked()),
    db.select({ checked: count() }).from(ct).where(and(unlinked(), isNotNull(ct.laMatchCheckedAt))),
    db.select({ suggested: count() }).from(ct).where(and(unlinked(), isNotNull(ct.laMatchId))),
    db.select({ several: count() }).from(ct).where(and(unlinked(), eq(ct.laMatchHow, "several"))),
  ]);
  return { total, checked, remaining: total - checked, suggested, several };
}

/** One time-boxed batch. Returns how many contacts were checked and whether any are left. */
export async function findLaMatches({ timeBudgetMs = 40_000 } = {}) {
  const db = await getDb();
  const ct = schema.contacts;
  const started = Date.now();
  let checked = 0;
  let found = 0;
  while (Date.now() - started < timeBudgetMs) {
    const batch = await db.select().from(ct).where(and(unlinked(), isNull(ct.laMatchCheckedAt))).orderBy(asc(ct.id)).limit(BATCH);
    if (!batch.length) return { checked, found, done: true };
    for (const p of batch) {
      if (Date.now() - started > timeBudgetMs) break;
      const match = await lookUp(p);
      if (match.id) found++;
      await db.update(ct).set({ laMatchId: match.id, laMatchName: match.name, laMatchHow: match.how, laMatchCheckedAt: new Date() }).where(eq(ct.id, p.id));
      checked++;
    }
  }
  return { checked, found, done: false };
}

/** Check every unlinked contact again (e.g. after contacts were added in Lead Alchemist). */
export async function resetLaMatches() {
  const db = await getDb();
  const ct = schema.contacts;
  await db.update(ct).set({ laMatchCheckedAt: null }).where(unlinked());
}

type Match = { id: string | null; name: string | null; how: string | null };

/** The one exact Lead Alchemist match for a contact (leaving out one staff rejected), or why there isn't one. */
async function lookUp(p: Contact): Promise<Match> {
  const candidates = (await laCandidates(p, { byName: false })).filter((c) => c.contact.id !== p.laMatchDeniedId);
  const exact = exactMatch(candidates);
  if (exact) return { id: exact.id, name: laName(exact), how: candidates.find((c) => c.contact.id === exact.id)!.how.join("+") };
  return { id: null, name: null, how: candidates.length > 1 ? "several" : null };
}

/** "Check Lead Alchemist" on one contact: look it up now and save the suggestion (or that there's none). */
export async function checkLaMatch(contactId: string) {
  const db = await getDb();
  const ct = schema.contacts;
  const [p] = await db.select().from(ct).where(eq(ct.id, contactId)).limit(1);
  if (!p) throw new Error("That contact no longer exists.");
  const match = await lookUp(p);
  await db.update(ct).set({ laMatchId: match.id, laMatchName: match.name, laMatchHow: match.how, laMatchCheckedAt: new Date() }).where(eq(ct.id, p.id));
  return match;
}

/** "Not them": forget the suggestion and never suggest (or auto-link) that Lead Alchemist contact again. */
export async function denyLaMatch(contactId: string) {
  const db = await getDb();
  const ct = schema.contacts;
  const [p] = await db.select().from(ct).where(eq(ct.id, contactId)).limit(1);
  if (!p) throw new Error("That contact no longer exists.");
  await db
    .update(ct)
    .set({ laMatchDeniedId: p.laMatchId ?? p.laMatchDeniedId, laMatchId: null, laMatchName: null, laMatchHow: "denied", laMatchCheckedAt: new Date() })
    .where(eq(ct.id, p.id));
  return p;
}
