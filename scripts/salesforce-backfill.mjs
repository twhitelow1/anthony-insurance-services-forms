#!/usr/bin/env node
/**
 * One-time Salesforce backfill from the command line (same code as Admin → Clients →
 * Link existing Salesforce accounts). It drives the deployed app, so it needs no database
 * or Salesforce credentials locally, only the app's CRON_SECRET.
 *
 *   CRON_SECRET=… node scripts/salesforce-backfill.mjs --url https://anthony-insurance-services-forms.vercel.app
 *   CRON_SECRET=… node scripts/salesforce-backfill.mjs --url … --continue
 *   CRON_SECRET=… node scripts/salesforce-backfill.mjs --url … --apply --yes      (after reviewing the dry run)
 *
 * Writes the report CSV next to you: salesforce-backfill-<run>.csv
 */
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const base = (value("url") ?? process.env.APP_URL ?? "").replace(/\/+$/, "");
const secret = process.env.CRON_SECRET;
if (!base || !secret) {
  console.error("Usage: CRON_SECRET=… node scripts/salesforce-backfill.mjs --url https://<app> [--continue | --apply --yes]");
  process.exit(1);
}
if (flag("apply") && !flag("yes")) {
  console.error("Applying writes link fields to Salesforce. Review the dry-run report first, then add --yes.");
  process.exit(1);
}

const endpoint = `${base}/api/admin/salesforce-backfill`;
const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };

async function call(body) {
  const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.state;
}

const first = flag("continue") ? { action: "continue" } : { action: "start", mode: flag("apply") ? "apply" : "dry_run" };
let state = await call(first);
for (;;) {
  const c = state.counts;
  console.log(`${state.mode} ${state.runId.slice(0, 8)}: matched ${c.matched}, new ${c.new}, ambiguous ${c.ambiguous}, skipped ${c.skipped}, errors ${c.error}${state.done ? " (done)" : ""}`);
  if (state.stoppedReason) {
    console.log(state.stoppedReason);
    break;
  }
  if (state.done) break;
  state = await call({ action: "continue" });
}

const report = await fetch(`${endpoint}?report=${state.runId}`, { headers });
const file = `salesforce-backfill-${state.runId.slice(0, 8)}.csv`;
await writeFile(file, await report.text());
console.log(`Report: ${file}`);
