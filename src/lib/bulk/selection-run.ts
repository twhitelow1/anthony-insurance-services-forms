import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { saveSyncReport } from "./report";
import { addTally, type ContactTally } from "./tally";

/**
 * "Select all N matching" on a list: the bulk button the staff member pressed runs over every row
 * that matches the list's filters, across all pages. The matching IDs are taken when it starts
 * (so rows that drop out of the filter while it runs are still done), then worked through in
 * small time-boxed batches in the background (see ./background: each request works for a few
 * minutes, saving progress after every batch, then hands on to the next), so the page can be
 * closed. It can be stopped. One run per list at a time.
 */
export type SelectionScope = "contacts" | "mapping" | "accounts" | "la_import";

export interface SelectionRun {
  runId: string;
  scope: SelectionScope;
  /** Which bulk action (the list's own key for it). */
  action: string;
  /** What it does, e.g. "Synced to Lead Alchemist". */
  label: string;
  /** The ticked options that came with the button (e.g. createMissing). */
  options: Record<string, string>;
  ids: string[];
  position: number;
  done: number;
  notes: string[];
  /** Lead Alchemist syncs: what happened to each contact so far. */
  contacts?: ContactTally;
  phase: "running" | "done" | "stopped";
  error?: string;
  /** Set when it finishes or stops: its sync report (Admin → Sync reports). */
  report?: { id: string; text: string; clean: boolean };
  /** The filters it was started from, in words. */
  scopeText: string;
  startedBy: string;
  startedAt: string;
  updatedAt: string;
  /** While a background request is working on it: until when (so two never work on it at once). */
  leaseUntil?: string | null;
  /** Staff cleared its progress bar after it finished. */
  cleared?: boolean;
}

export interface BatchResult {
  done: number;
  notes: string[];
  contacts?: ContactTally;
  /** Rows the work didn't get to (its own time limit): the run puts them back in the queue. */
  notReached?: string[];
}

/** The "click again to do the rest" notes, which don't apply when the rest is queued for you. */
export const NOT_REACHED_NOTE = /(weren.?t|wasn.?t) reached in this run/;

/** The rows of `chunk` that were done, and the ones to queue again (in their original order). */
export function splitReached(chunk: string[], notReached: string[] | undefined) {
  const left = new Set(notReached ?? []);
  const done = chunk.filter((id) => !left.has(id));
  // Always move forward: a batch that reached nothing counts its first row as done.
  if (!done.length && chunk.length) return { done: chunk.slice(0, 1), left: chunk.slice(1).filter((id) => left.has(id)) };
  return { done, left: [...(notReached ?? [])].filter((id) => !done.includes(id)) };
}

/** More ticked rows than this run as a run (in batches, continuing on its own) instead of in one click. */
export const INLINE_LIMIT = 5;

/** The most rows one run takes. */
export const MAX_SELECTION = 20_000;
const CHUNK = 10;
/** Lists whose rows are big: an import row is a whole page of 100 submissions. */
const CHUNK_SIZE: Partial<Record<SelectionScope, number>> = { la_import: 1 };
const key = (scope: SelectionScope) => `selection_run:${scope}`;

export async function getSelectionRun(scope: SelectionScope): Promise<SelectionRun | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key(scope))).limit(1);
  return (row?.value as SelectionRun) ?? null;
}

async function save(run: SelectionRun) {
  const db = await getDb();
  const value = { ...run, updatedAt: new Date().toISOString() };
  await db
    .insert(schema.appSettings)
    .values({ key: key(run.scope), value, updatedBy: run.startedBy })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
  return value;
}

export async function startSelectionRun(
  scope: SelectionScope,
  opts: { action: string; label: string; options?: Record<string, string>; ids: string[]; scopeText: string },
  actor: string,
): Promise<SelectionRun> {
  const current = await getSelectionRun(scope);
  if (current?.phase === "running") throw new Error(`"${current.label}" is still running on ${current.ids.length.toLocaleString("en-US")} rows. Stop it first.`);
  const ids = [...new Set(opts.ids)];
  if (!ids.length) throw new Error("Nothing matches the current filters.");
  if (ids.length > MAX_SELECTION) throw new Error(`That's ${ids.length.toLocaleString("en-US")} rows; narrow the filters to ${MAX_SELECTION.toLocaleString("en-US")} or fewer.`);
  const now = new Date().toISOString();
  return save({
    runId: randomUUID(),
    scope,
    action: opts.action,
    label: opts.label,
    options: opts.options ?? {},
    ids,
    position: 0,
    done: 0,
    notes: [],
    phase: "running",
    scopeText: opts.scopeText,
    startedBy: actor,
    startedAt: now,
    updatedAt: now,
  });
}

/**
 * Take the run for one background request: only when it's running and nobody else holds it (or
 * their hold ran out, e.g. the request was cut off). Null when there's nothing to do.
 */
export async function claimSelectionRun(scope: SelectionScope, holdMs: number): Promise<SelectionRun | null> {
  const db = await getDb();
  const until = new Date(Date.now() + holdMs).toISOString();
  const [row] = await db
    .update(schema.appSettings)
    .set({ value: sql`jsonb_set(${schema.appSettings.value}, '{leaseUntil}', to_jsonb(${until}::text))`, updatedAt: new Date() })
    .where(
      and(
        eq(schema.appSettings.key, key(scope)),
        sql`${schema.appSettings.value}->>'phase' = 'running'`,
        sql`coalesce((${schema.appSettings.value}->>'leaseUntil')::timestamptz, 'epoch') < now()`,
      ),
    )
    .returning();
  return (row?.value as SelectionRun) ?? null;
}

/**
 * Work through the run for up to `timeBudgetMs`, saving progress after every batch (so a cut-off
 * request loses at most one batch), and stopping at once if staff pressed Stop meanwhile.
 * `claimed`: the run as claimed by claimSelectionRun; its hold is let go at the end.
 */
export async function stepSelectionRun(
  scope: SelectionScope,
  work: (run: SelectionRun) => ((ids: string[], actor: string) => Promise<BatchResult>) | null,
  timeBudgetMs = 35_000,
  claimed?: SelectionRun,
): Promise<SelectionRun | null> {
  const run = claimed ?? (await getSelectionRun(scope));
  if (!run || run.phase !== "running") return run;
  const fn = work(run);
  if (!fn) return save({ ...run, phase: "stopped", error: "This action can't run on all matching rows any more." });
  const started = Date.now();
  const from = run.position;
  // At least one batch per step, so it always moves forward.
  while (run.position < run.ids.length && (run.position === from || Date.now() - started < timeBudgetMs)) {
    const chunk = run.ids.slice(run.position, run.position + (CHUNK_SIZE[run.scope] ?? CHUNK));
    try {
      const r = await fn(chunk, run.startedBy);
      run.done += r.done;
      const { done, left } = splitReached(chunk, r.notReached);
      run.notes = [...run.notes, ...(r.notReached ? r.notes.filter((n) => !NOT_REACHED_NOTE.test(n)) : r.notes)].slice(0, 6000);
      run.contacts = addTally(run.contacts, r.contacts);
      if (left.length) {
        // What wasn't reached goes straight back in the queue, right after what was done.
        run.ids = [...run.ids.slice(0, run.position), ...done, ...left, ...run.ids.slice(run.position + chunk.length)];
        run.position += done.length;
      } else run.position += chunk.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Stop rather than skip ahead: a connection or permission problem would fail every batch.
      const now = await getSelectionRun(scope);
      if (!now || now.runId !== run.runId || now.phase !== "running") return now;
      return save(await withReport({ ...run, phase: "stopped", error: message.slice(0, 300), leaseUntil: null }));
    }
    // Saved after every batch, unless staff stopped it (or started another) meanwhile.
    const now = await getSelectionRun(scope);
    if (!now || now.runId !== run.runId || now.phase !== "running") return now;
    if (run.position < run.ids.length) await save(run);
  }
  if (run.position >= run.ids.length) run.phase = "done";
  return save(run.phase === "done" ? await withReport({ ...run, leaseUntil: null }) : { ...run, leaseUntil: null });
}

const PAGE: Record<SelectionScope, string> = { contacts: "/admin/contacts", mapping: "/admin/mapping", accounts: "/admin/clients?view=all", la_import: "/admin/import" };

/** A finished or stopped run's report: rows not reached count as not done, and why it stopped is an error. */
async function withReport(run: SelectionRun): Promise<SelectionRun> {
  const notes = [...run.notes];
  if (run.position < run.ids.length) notes.unshift(`${run.ids.length - run.position} weren't reached: the run ${run.error?.startsWith("Stopped by") ? "was stopped" : "stopped"}.`);
  if (run.error && !run.error.startsWith("Stopped by")) notes.unshift(`Stopped on an error: ${run.error}`);
  try {
    const r = await saveSyncReport({ title: run.label, scope: `All matching: ${run.scopeText}`, page: PAGE[run.scope], actor: run.startedBy, total: run.ids.length, done: run.done, notes, contacts: run.contacts });
    return { ...run, report: { id: r.report.id, text: r.text, clean: r.clean } };
  } catch (err) {
    console.error("[selection run] couldn't save the report:", err instanceof Error ? err.message : err);
    return run;
  }
}

export async function stopSelectionRun(scope: SelectionScope, actor: string) {
  const run = await getSelectionRun(scope);
  if (!run || run.phase !== "running") return run;
  return save(await withReport({ ...run, phase: "stopped", error: `Stopped by ${actor.replace(/^staff:/, "")}`, leaseUntil: null }));
}

/** Shown on the list while it runs, and for a while after. */
export function showSelectionRun(run: SelectionRun | null): run is SelectionRun {
  return !!run && (run.phase === "running" || (!run.cleared && Date.now() - new Date(run.updatedAt).getTime() < 30 * 60_000));
}

/** Running, but nothing has worked on it or moved it for a few minutes (a background request was cut off). */
export function runStalled(run: SelectionRun, now = Date.now()): boolean {
  if (run.phase !== "running") return false;
  const held = !!run.leaseUntil && new Date(run.leaseUntil).getTime() > now;
  return !held && now - new Date(run.updatedAt).getTime() > 3 * 60_000;
}

/** Clear a finished or stopped run's progress bar (its sync report stays under Sync reports). */
export async function clearSelectionRun(scope: SelectionScope) {
  const run = await getSelectionRun(scope);
  if (!run || run.phase === "running") return run;
  return save({ ...run, cleared: true });
}
