import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { claimSelectionRun, getSelectionRun, runStalled, startSelectionRun, stepSelectionRun, type SelectionRun, type SelectionScope } from "./selection-run";
import { selectionWork } from "./work";

/**
 * Bulk runs work in the background, not in the staff member's browser: starting a run (or pressing
 * Continue) asks /api/bulk/step to work on it. Each request works for a few minutes, saving after
 * every batch, then asks for the next request, until the run is done or stopped. If a request is
 * cut off, its hold on the run expires and the next admin page load (or the daily cron) picks it up.
 */
export const SCOPES: SelectionScope[] = ["contacts", "mapping", "accounts"];

/** How long one request works before handing on (the route's limit is longer). */
export const STEP_BUDGET_MS = 200_000;
/** A request's hold on the run: its budget plus the longest batch. */
const HOLD_MS = STEP_BUDGET_MS + 90_000;

/** The secret the step route checks (derived from the server's own keys; never shown). */
export function bulkStepToken(): string | null {
  const own = process.env.INTEGRATIONS_KEY?.trim();
  const base = own && own.length >= 32 ? own : process.env.SESSION_SECRET;
  if (!base || base.length < 32) return null;
  return createHmac("sha256", base).update("bulk-step-v1").digest("base64url").slice(0, 32);
}

export function isBulkStepToken(candidate: string | null): boolean {
  const token = bulkStepToken();
  if (!token || !candidate || candidate.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
}

/** This deployment's own address, for asking itself to carry on. */
export function selfBase(): string | null {
  const own = process.env.APP_URL?.trim();
  if (own) return own.replace(/\/$/, "");
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : null;
}

/** Ask the background route to work on this list's run. Returns false if it couldn't be asked. */
export async function triggerSelectionRun(scope: SelectionScope): Promise<boolean> {
  const base = selfBase();
  const token = bulkStepToken();
  if (!base || !token) return false;
  try {
    const res = await fetch(`${base}/api/bulk/step?scope=${scope}`, { method: "POST", headers: { "x-bulk-token": token }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    return res.ok;
  } catch (err) {
    console.warn("[bulk] couldn't start the background step:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** One background request's work: claim the run, work for a while, and say whether more is left. */
export async function workSelectionRun(scope: SelectionScope): Promise<SelectionRun | null> {
  const claimed = await claimSelectionRun(scope, HOLD_MS);
  if (!claimed) return null;
  const run = await stepSelectionRun(scope, selectionWork(scope), STEP_BUDGET_MS, claimed);
  if (run?.phase === "stopped" && run.error) console.error(`[bulk] ${scope} run stopped:`, run.error);
  return run;
}

/** Runs that are running but nobody is working on (a request was cut off): start them again. */
export async function resumeStalledRuns(): Promise<void> {
  for (const scope of SCOPES) {
    const run = await getSelectionRun(scope).catch(() => null);
    if (run && runStalled(run)) await triggerSelectionRun(scope);
  }
}

/** Start a list's run and set it working in the background straight away. */
export async function startBackgroundRun(...args: Parameters<typeof startSelectionRun>): Promise<SelectionRun> {
  const run = await startSelectionRun(...args);
  after(() => triggerSelectionRun(args[0]).then(() => undefined));
  return run;
}
