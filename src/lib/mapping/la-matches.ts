import "server-only";
import { and, asc, count, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
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
      let match: { id: string | null; name: string | null; how: string | null } = { id: null, name: null, how: null };
      const candidates = await laCandidates(p, { byName: false });
      const exact = exactMatch(candidates);
      if (exact) {
        match = { id: exact.id, name: laName(exact), how: candidates.find((c) => c.contact.id === exact.id)!.how.join("+") };
        found++;
      } else if (candidates.length > 1) match = { id: null, name: null, how: "several" };
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
