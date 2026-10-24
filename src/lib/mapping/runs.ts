import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { MappingAction, MappingConfidence, MappingDetail, MappingKind, MappingRow } from "@/lib/db/schema";

/**
 * A mapping run: scan (read-only, builds the rows staff review), review (staff change any
 * row), then apply (only after staff confirm). State lives in app_settings so a run survives
 * between requests; each scan or apply call does one time-boxed batch and can be repeated.
 */
export type MappingPhase = "scanning" | "review" | "applying" | "done";

export interface MappingRun {
  runId: string;
  kind: MappingKind;
  phase: MappingPhase;
  /** Where the scan or apply got to (a Salesforce Account ID, an app Account ID or a row ID). */
  cursor: string | null;
  scanned: number;
  applied: number;
  errors: number;
  options: Record<string, boolean>;
  startedBy: string;
  confirmedBy?: string;
  startedAt: string;
  updatedAt: string;
  stoppedReason?: string;
}

export const MAPPING_TITLES: Record<MappingKind, string> = {
  salesforce_import: "Salesforce Accounts → app Accounts",
  la_companies: "App Accounts → Lead Alchemist Companies",
  salesforce_push: "Past applications → Salesforce",
};

const stateKey = (kind: MappingKind) => `mapping_run:${kind}`;

export async function getRun(kind: MappingKind): Promise<MappingRun | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, stateKey(kind))).limit(1);
  return (row?.value as MappingRun) ?? null;
}

export async function saveRun(run: MappingRun) {
  const db = await getDb();
  const value = { ...run, updatedAt: new Date().toISOString() };
  await db
    .insert(schema.appSettings)
    .values({ key: stateKey(run.kind), value, updatedBy: run.confirmedBy ?? run.startedBy })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
  return value;
}

/** Start a fresh scan (the previous run's rows stay for the record but are no longer shown). */
export async function startRun(kind: MappingKind, actor: string, options: Record<string, boolean> = {}): Promise<MappingRun> {
  const now = new Date().toISOString();
  return saveRun({ runId: randomUUID(), kind, phase: "scanning", cursor: null, scanned: 0, applied: 0, errors: 0, options, startedBy: actor, startedAt: now, updatedAt: now });
}

export interface NewMappingRow {
  sourceId: string;
  sourceName: string;
  sourceDetail: MappingDetail;
  proposal: MappingAction;
  confidence: MappingConfidence;
  targetId?: string | null;
  targetName?: string | null;
  reason?: string | null;
  candidates?: { id: string; name: string; note?: string }[];
}

export async function addRows(run: MappingRun, rows: NewMappingRow[]) {
  if (!rows.length) return;
  const db = await getDb();
  await db.insert(schema.mappingRows).values(rows.map((r) => ({ ...r, runId: run.runId, kind: run.kind, candidates: r.candidates ?? [] })));
}

export type RowFilter = "all" | "check" | "link" | "create" | "skip" | "error";

/** "check": the rows a person should look at (name-only matches and errors). */
function rowFilterWhere(filter: RowFilter): SQL | undefined {
  const t = schema.mappingRows;
  const action = sql`coalesce(${t.decision}, ${t.proposal})`;
  switch (filter) {
    case "check":
      return sql`(${t.confidence} = 'name_only' or ${t.status} = 'error')`;
    case "link":
    case "create":
    case "skip":
      return sql`${action} = ${filter}`;
    case "error":
      return eq(t.status, "error");
    default:
      return undefined;
  }
}

export async function listRows(runId: string, { filter = "all", page = 1, pageSize = 100 }: { filter?: RowFilter; page?: number; pageSize?: number } = {}) {
  const db = await getDb();
  const t = schema.mappingRows;
  const where = and(eq(t.runId, runId), rowFilterWhere(filter));
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(t).where(where).orderBy(asc(t.id)).limit(pageSize).offset((Math.max(page, 1) - 1) * pageSize),
    db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(t).where(where),
  ]);
  return { rows, total };
}

/** Counts per final action and confidence, for the summary above the table. */
export async function summarize(runId: string) {
  const db = await getDb();
  const t = schema.mappingRows;
  const rows = await db
    .select({
      action: sql<MappingAction>`coalesce(${t.decision}, ${t.proposal})`,
      confidence: t.confidence,
      status: t.status,
      n: sql<number>`count(*)`.mapWith(Number),
    })
    .from(t)
    .where(eq(t.runId, runId))
    .groupBy(sql`1`, t.confidence, t.status);
  const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((a, r) => a + r.n, 0);
  return {
    total: sum(() => true),
    link: sum((r) => r.action === "link"),
    create: sum((r) => r.action === "create"),
    skip: sum((r) => r.action === "skip"),
    check: sum((r) => r.confidence === "name_only" || r.status === "error"),
    applied: sum((r) => r.status === "applied"),
    errors: sum((r) => r.status === "error"),
  };
}

/** Save staff choices: "link:<targetId>", "create" or "skip" per row. Only rows of this run that aren't applied yet. */
export async function saveDecisions(runId: string, decisions: Record<number, string>) {
  const db = await getDb();
  const t = schema.mappingRows;
  const ids = Object.keys(decisions).map(Number).filter(Number.isInteger);
  if (!ids.length) return 0;
  const rows = await db.select().from(t).where(and(eq(t.runId, runId), inArray(t.id, ids)));
  let changed = 0;
  for (const row of rows) {
    if (row.status === "applied") continue;
    const raw = decisions[row.id];
    const at = raw.indexOf(":");
    const action = at === -1 ? raw : raw.slice(0, at);
    const targetId = at === -1 ? "" : raw.slice(at + 1);
    if (action !== "link" && action !== "create" && action !== "skip") continue;
    if (action === "link" && !targetId) continue;
    // Linking only to the proposed target or one of the listed candidates.
    if (action === "link" && targetId !== row.targetId && !row.candidates.some((c) => c.id === targetId)) continue;
    const same = action === row.proposal && (action !== "link" || targetId === row.targetId);
    await db
      .update(t)
      .set({ decision: same ? null : action, decisionTargetId: action === "link" && !same ? targetId : null, updatedAt: new Date() })
      .where(eq(t.id, row.id));
    changed++;
  }
  return changed;
}

/** The action and target a row will be applied with. */
export function finalChoice(row: MappingRow): { action: MappingAction; targetId: string | null } {
  const action = row.decision ?? row.proposal;
  return { action, targetId: action === "link" ? (row.decisionTargetId ?? row.targetId) : null };
}

export async function pendingRows(runId: string, afterId: number, limit: number) {
  const db = await getDb();
  const t = schema.mappingRows;
  return db
    .select()
    .from(t)
    .where(and(eq(t.runId, runId), eq(t.status, "pending"), sql`${t.id} > ${afterId}`))
    .orderBy(asc(t.id))
    .limit(limit);
}

export async function markRow(id: number, status: "applied" | "error", result: string) {
  const db = await getDb();
  await db.update(schema.mappingRows).set({ status, result: result.slice(0, 500), updatedAt: new Date() }).where(eq(schema.mappingRows.id, id));
}

/** Run `step` over pending rows until the time budget is used up. Shared by every mapping's apply. */
export async function applyBatch(run: MappingRun, step: (row: MappingRow) => Promise<string>, budgetMs = 40_000): Promise<MappingRun> {
  if (run.phase !== "applying") return run;
  const started = Date.now();
  let cursor = Number(run.cursor ?? 0);
  while (Date.now() - started < budgetMs) {
    const rows = await pendingRows(run.runId, cursor, 25);
    if (!rows.length) {
      run.phase = "done";
      break;
    }
    for (const row of rows) {
      if (Date.now() - started >= budgetMs) break;
      try {
        await markRow(row.id, "applied", await step(row));
        run.applied++;
      } catch (err) {
        await markRow(row.id, "error", err instanceof Error ? err.message : String(err));
        run.errors++;
      }
      cursor = row.id;
      run.cursor = String(cursor);
    }
  }
  return saveRun(run);
}

/** Staff confirmed the mapping: switch to applying. */
export async function confirmRun(kind: MappingKind, actor: string, options: Record<string, boolean> = {}) {
  const run = await getRun(kind);
  if (!run || run.phase !== "review") throw new Error("There's no reviewed mapping to confirm. Scan first.");
  return saveRun({ ...run, phase: "applying", cursor: null, confirmedBy: actor, options: { ...run.options, ...options } });
}
