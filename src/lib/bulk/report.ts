import "server-only";
import { desc, eq, count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { raiseNotification } from "@/lib/notifications/repo";
import { describeTally, skippedOf, type ContactTally } from "./tally";

/**
 * Every bulk sync ends with a report: "All 25 synced", or how many were done and each error,
 * conflict and skipped row. The sync functions describe problems in plain sentences; they're
 * sorted here by what they say (kept in one place, with tests).
 */
export interface Sorted {
  errors: string[];
  conflicts: string[];
  skipped: string[];
  notes: string[];
}

const ERROR = /fail|error|couldn.?t|could not|can.?t |cannot|isn.?t connected|not connected|wasn.?t found|not found|stopped|denied|invalid|timed? ?out|rejected|\b(400|401|403|404|429|500|502|503)\b/i;
const CONFLICT = /already linked|have (this|the same) name|are named like|same name|pick one|pick the right|merge|another (account|company)|in a different|differ|conflict|duplicate/i;
const SKIPPED = /weren.?t reached|not reached|skipped|add (it|them) first|aren.?t in AIS Connect|isn.?t in AIS Connect|not in AIS Connect yet|no suggested match|no email or phone|nothing to/i;

export function sortNotes(notes: string[]): Sorted {
  const out: Sorted = { errors: [], conflicts: [], skipped: [], notes: [] };
  for (const raw of notes) {
    const n = raw.trim();
    if (!n) continue;
    if (SKIPPED.test(n)) out.skipped.push(n);
    else if (ERROR.test(n)) out.errors.push(n);
    else if (CONFLICT.test(n)) out.conflicts.push(n);
    else out.notes.push(n);
  }
  return out;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

/**
 * One line for the result message: "All 25 done, no conflicts or errors." only when nothing at all
 * was skipped, failed or in conflict (for a Lead Alchemist sync: every contact linked or created);
 * otherwise "Needs attention: 22 of 25 done · 2 conflicts · 1 error · contacts: …".
 */
export function summarize(r: { title: string; total: number; done: number; contacts?: ContactTally | null } & Sorted): { text: string; clean: boolean } {
  const contactProblems = r.contacts ? r.contacts.failed + skippedOf(r.contacts) : 0;
  const problems = r.errors.length + r.conflicts.length + r.skipped.length + contactProblems;
  const clean = r.done >= r.total && !problems;
  const contacts = r.contacts ? ` Contacts: ${describeTally(r.contacts).replace(/^[\d,]+ contacts?: /, "")}.` : "";
  if (clean) return { text: `${r.title}: all ${fmt(r.total)} done, no conflicts or errors.${contacts}`, clean: true };
  const parts = [`${fmt(Math.min(r.done, r.total))} of ${fmt(r.total)} done`];
  if (r.conflicts.length) parts.push(plural(r.conflicts.length, "conflict"));
  if (r.errors.length) parts.push(plural(r.errors.length, "error"));
  if (r.skipped.length) parts.push(plural(r.skipped.length, "skipped note"));
  return { text: `Needs attention: ${r.title}: ${parts.join(" · ")}.${contacts}`, clean: false };
}

const clip = (list: string[]) => list.slice(0, 6000).map((s) => s.slice(0, 500));

/**
 * Save the report of a finished bulk sync and say how it went. A conflict or an error also
 * raises a "Sync needs attention" card on the Notifications board (rows merely skipped don't).
 */
export async function saveSyncReport(input: { title: string; scope: string; page?: string | null; actor: string; total: number; done: number; notes: string[]; contacts?: ContactTally | null }) {
  const sorted = sortNotes(input.notes);
  const { text, clean } = summarize({ title: input.title, total: input.total, done: input.done, contacts: input.contacts, ...sorted });
  const db = await getDb();
  const [report] = await db
    .insert(schema.syncReports)
    .values({
      title: input.title,
      scope: input.scope.slice(0, 300),
      page: input.page ?? null,
      actor: input.actor,
      total: input.total,
      done: Math.min(input.done, input.total),
      errors: clip(sorted.errors),
      conflicts: clip(sorted.conflicts),
      skipped: clip(sorted.skipped),
      notes: clip(sorted.notes),
      contactCounts: input.contacts ?? null,
    })
    .returning();
  const href = `/admin/sync-reports/${report.id}`;
  if (sorted.errors.length || sorted.conflicts.length) {
    await raiseNotification(
      { kind: "sync_issues", title: `Sync needs attention: ${input.title}`, detail: `${text} ${input.scope}. Full report: ${href}`, data: { reportId: report.id, href } },
      input.actor,
    ).catch((err) => console.error("[sync report] couldn't raise the notification:", err instanceof Error ? err.message : err));
  }
  return { report, text, clean, href };
}

export async function getSyncReport(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const db = await getDb();
  const [row] = await db.select().from(schema.syncReports).where(eq(schema.syncReports.id, id)).limit(1);
  return row ?? null;
}

export async function listSyncReports(limit = 50, offset = 0) {
  const db = await getDb();
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(schema.syncReports).orderBy(desc(schema.syncReports.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(schema.syncReports),
  ]);
  return { rows, total };
}
