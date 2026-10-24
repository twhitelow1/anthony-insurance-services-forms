import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Links } from "@/lib/integrations/urls";
import type { AccountRow } from "@/lib/mapping/salesforce-import";
import { soqlString, type SalesforceApi } from "./api";
import { accountSelect, visibleFields } from "./fields";
import { hiddenSet } from "./hidden";
import { NO_TYPE, syncAccount } from "./manager";
import { saveSyncReport } from "@/lib/bulk/report";

/**
 * "Select all N matching → Sync": brings every Salesforce Account that matches the search and
 * Account Type filter into the app, in time-boxed batches (one per request; the Salesforce page
 * keeps calling while it's open, and it can be resumed). Deactivated and removed accounts are
 * skipped. It reads Salesforce; writing the app's links back onto each Account and Contact is
 * optional because it costs API calls (about one per record).
 */
export interface BulkSyncRun {
  runId: string;
  q: string;
  type: string;
  writeLinks: boolean;
  /** The last Salesforce Account ID done (the run goes through Accounts in ID order). */
  cursor: string | null;
  total: number | null;
  done: number;
  created: number;
  linked: number;
  skipped: number;
  failed: number;
  errors: { name: string; error: string }[];
  phase: "running" | "paused" | "done" | "stopped";
  pausedReason?: string;
  /** Set when it finishes or is stopped: its sync report (Admin → Sync reports). */
  report?: { id: string; text: string; clean: boolean };
  startedBy: string;
  startedAt: string;
  updatedAt: string;
}

const KEY = "salesforce_bulk_sync";
const BATCH = 50;

export async function getBulkSync(): Promise<BulkSyncRun | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).limit(1);
  return (row?.value as BulkSyncRun) ?? null;
}

async function save(run: BulkSyncRun) {
  const db = await getDb();
  const value = { ...run, updatedAt: new Date().toISOString() };
  await db
    .insert(schema.appSettings)
    .values({ key: KEY, value, updatedBy: run.startedBy })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
  return value;
}

const likeTerm = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

async function conditions(sf: SalesforceApi, run: Pick<BulkSyncRun, "q" | "type">) {
  const typeVisible = (await visibleFields(sf, "Account", ["Type"])).includes("Type");
  return [
    run.q ? `Name LIKE ${soqlString(`%${likeTerm(run.q)}%`)}` : null,
    run.type && typeVisible ? (run.type === NO_TYPE ? "Type = null" : `Type = ${soqlString(run.type)}`) : null,
  ].filter((c): c is string => !!c);
}

export async function startBulkSync(sf: SalesforceApi, opts: { q: string; type: string; writeLinks: boolean }, actor: string): Promise<BulkSyncRun> {
  const current = await getBulkSync();
  if (current && (current.phase === "running" || current.phase === "paused")) throw new Error("A sync of all accounts is already in progress. Stop it first.");
  const conds = await conditions(sf, opts);
  const count = await sf
    .queryPage(`SELECT COUNT() FROM Account${conds.length ? ` WHERE ${conds.join(" AND ")}` : ""}`)
    .then((r) => r.totalSize ?? null)
    .catch(() => null);
  const now = new Date().toISOString();
  return save({
    runId: randomUUID(),
    q: opts.q,
    type: opts.type,
    writeLinks: opts.writeLinks,
    cursor: null,
    total: count,
    done: 0,
    created: 0,
    linked: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    phase: "running",
    startedBy: actor,
    startedAt: now,
    updatedAt: now,
  });
}

export async function stopBulkSync(actor: string) {
  const run = await getBulkSync();
  if (!run || run.phase === "done" || run.phase === "stopped") return run;
  return save(await withReport({ ...run, phase: "stopped", pausedReason: `Stopped by ${actor.replace(/^staff:/, "")}` }));
}

export async function resumeBulkSync() {
  const run = await getBulkSync();
  if (!run || run.phase !== "paused") return run;
  return save({ ...run, phase: "running", pausedReason: undefined });
}

/** One time-boxed batch. Call again (the page does) until the phase isn't "running". */
export async function stepBulkSync(deps: { sf: SalesforceApi; links: Links; timeBudgetMs?: number }): Promise<BulkSyncRun | null> {
  const run = await getBulkSync();
  if (!run || run.phase !== "running") return run;
  const started = Date.now();
  const budget = deps.timeBudgetMs ?? 40_000;
  const db = await getDb();
  const base = await conditions(deps.sf, run);
  const select = await accountSelect(deps.sf);

  while (Date.now() - started < budget) {
    const conds = [...base, ...(run.cursor ? [`Id > ${soqlString(run.cursor)}`] : [])];
    const { records } = await deps.sf.queryPage<AccountRow>(`${select}${conds.length ? ` WHERE ${conds.join(" AND ")}` : ""} ORDER BY Id LIMIT ${BATCH}`);
    if (!records.length) {
      run.phase = "done";
      break;
    }
    const ids = records.map((r) => r.Id);
    const [inApp, hidden] = await Promise.all([
      db
        .select({ sfAccountId: schema.clients.sfAccountId, deactivatedAt: schema.clients.deactivatedAt })
        .from(schema.clients)
        .where(and(inArray(schema.clients.sfAccountId, ids), isNull(schema.clients.mergedInto))),
      hiddenSet(ids),
    ]);
    for (const account of records) {
      if (Date.now() - started > budget) break;
      const existing = inApp.find((c) => c.sfAccountId === account.Id);
      if (existing?.deactivatedAt || hidden.has(account.Id)) run.skipped++;
      else {
        try {
          const r = await syncAccount(account.Id, { sf: deps.sf, links: deps.links, writeLinks: run.writeLinks }, run.startedBy, account);
          if (r.result.startsWith("Created")) run.created++;
          else run.linked++;
        } catch (err) {
          run.failed++;
          run.errors = [{ name: account.Name, error: err instanceof Error ? err.message.slice(0, 200) : String(err) }, ...run.errors].slice(0, 20);
        }
      }
      run.done++;
      run.cursor = account.Id;
    }
    if (records.length < BATCH && run.cursor === records.at(-1)!.Id) {
      run.phase = "done";
      break;
    }
    const usage = deps.sf.usage();
    if (usage && usage.used / usage.max > 0.8) {
      run.phase = "paused";
      run.pausedReason = `Salesforce API use is at ${usage.used} of ${usage.max} for today. Resume tomorrow (or once it drops).`;
      break;
    }
  }
  return save(run.phase === "done" ? await withReport(run) : run);
}

/** The run's sync report: synced, skipped (deactivated or removed here), each failure, and rows not reached if stopped. */
async function withReport(run: BulkSyncRun): Promise<BulkSyncRun> {
  const notes = [
    ...(run.phase === "stopped" && run.total !== null && run.done < run.total ? [`${run.total - run.done} weren't reached: the run was stopped.`] : []),
    ...(run.skipped ? [`${run.skipped} skipped: deactivated or removed in AIS Connect.`] : []),
    ...run.errors.map((e) => `${e.name} failed: ${e.error}`),
    ...(run.failed > run.errors.length ? [`${run.failed - run.errors.length} more failed (only the latest ${run.errors.length} errors are kept).`] : []),
  ];
  const scope = ["All matching Salesforce Accounts", run.q && `name contains "${run.q}"`, run.type && `Type: ${run.type === NO_TYPE ? "no type" : run.type}`].filter(Boolean).join(", ");
  try {
    const r = await saveSyncReport({
      title: "Synced into AIS Connect",
      scope,
      page: "/admin/salesforce",
      actor: run.startedBy,
      total: run.total ?? run.done,
      done: run.created + run.linked + run.skipped,
      notes,
    });
    return { ...run, report: { id: r.report.id, text: r.text, clean: r.clean } };
  } catch (err) {
    console.error("[bulk sync] couldn't save the report:", err instanceof Error ? err.message : err);
    return run;
  }
}
