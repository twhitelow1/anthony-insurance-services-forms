import "server-only";
import { selectList } from "@/lib/salesforce/fields";
import { and, asc, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Client, MappingRow } from "@/lib/db/schema";
import { addClientEvent, getClient, listAccountContacts, setClientSalesforce } from "@/lib/clients/repo";
import { soqlString, type SalesforceApi } from "@/lib/salesforce/api";
import { enqueueSalesforceSync } from "@/lib/salesforce/jobs";
import { matchSalesforce } from "@/lib/salesforce/match";
import { addRows, applyBatch, finalChoice, saveRun, type MappingRun, type NewMappingRow } from "./runs";

/**
 * Past applications → Salesforce, one row per app Account that has submitted applications
 * not yet in Salesforce (test, declined and withdrawn ones never go). The scan only reads
 * Salesforce and proposes the Salesforce Account to use:
 * - link (exact): the app Account is already linked;
 * - link (strong): the sync's own rules find it (same name and phone, or the applicant's Contact);
 * - skip (name_only): a Salesforce Account shares the name but nothing confirms it: staff pick
 *   one of the candidates, choose "create new", or leave it;
 * - create: nothing like it in Salesforce.
 * Applying sets the link (or marks "create new") and queues each application's sync, which
 * then creates the Opportunity, Contact role, PDF and Chatter note as for a new submission.
 */
const PAGE = 100;

export interface SalesforcePushDeps {
  sf: SalesforceApi;
  timeBudgetMs?: number;
}

const unsynced = () =>
  and(
    eq(schema.applications.isTest, false),
    notInArray(schema.applications.status, ["declined", "withdrawn"]),
    inArray(schema.applications.sfSyncStatus, ["not_synced", "error", "needs_review"]),
  );

async function pendingApplications(clientId: string) {
  const db = await getDb();
  return db
    .select({ id: schema.applications.id })
    .from(schema.applications)
    .where(and(eq(schema.applications.clientId, clientId), unsynced()));
}

async function proposeFor(account: Client, sf: SalesforceApi): Promise<NewMappingRow> {
  const people = (await listAccountContacts(account.id)).filter((p) => p.homeHere || p.primaryEmail === account.primaryEmail);
  const apps = await pendingApplications(account.id);
  const base = {
    sourceId: account.id,
    sourceName: account.name,
    sourceDetail: {
      phone: account.phones[0] ?? null,
      website: account.website,
      city: account.address?.city ?? null,
      state: account.address?.state ?? null,
      applications: apps.length,
      contacts: people.map((p) => ({ name: p.name, email: p.primaryEmail })),
    },
  };
  if (account.sfAccountId) {
    const [a] = await sf.query<{ Id: string; Name: string }>(`SELECT Id, Name FROM Account WHERE Id = ${soqlString(account.sfAccountId)} LIMIT 1`);
    if (a) return { ...base, proposal: "link", confidence: "exact", targetId: a.Id, targetName: a.Name, reason: "Already linked" };
  }
  const email = account.primaryEmail ?? people.find((p) => p.primaryEmail)?.primaryEmail ?? "";
  const m = await matchSalesforce(sf, { email, accountName: account.name, phone: account.phones[0], isIndividual: account.isIndividual });
  if (m.kind === "contact" || m.kind === "account") {
    return {
      ...base,
      proposal: "link",
      confidence: "strong",
      targetId: m.accountId,
      targetName: m.accountName,
      reason: m.kind === "contact" ? "The applicant is a Contact on this Account" : "Same name and phone",
    };
  }
  if (m.kind === "review") {
    const same = await sf.query<{ Id: string; Name: string; Phone: string | null; BillingCity: string | null }>(
      `SELECT ${await selectList(sf, "Account", ["Name", "Phone", "BillingCity"])} FROM Account WHERE Name = ${soqlString(account.name)} LIMIT 8`,
    );
    return {
      ...base,
      proposal: "skip",
      confidence: "name_only",
      reason: `${m.reason}: pick the right Account or create a new one`,
      candidates: same.map((a) => ({ id: a.Id, name: a.Name, note: [a.Phone, a.BillingCity].filter(Boolean).join(", ") || undefined })),
    };
  }
  return { ...base, proposal: "create", confidence: "none", reason: "Not in Salesforce yet" };
}

/** Accounts with applications still to send, after the cursor. */
async function accountsToPush(cursor: string | null, limit: number): Promise<Client[]> {
  const db = await getDb();
  const withApps = db
    .select({ id: schema.applications.clientId })
    .from(schema.applications)
    .where(and(unsynced(), sql`${schema.applications.clientId} is not null`));
  return db
    .select()
    .from(schema.clients)
    .where(and(isNull(schema.clients.mergedInto), inArray(schema.clients.id, withApps), cursor ? gt(schema.clients.id, cursor) : undefined))
    .orderBy(asc(schema.clients.id))
    .limit(limit);
}

export async function scanPushBatch(run: MappingRun, deps: SalesforcePushDeps): Promise<MappingRun> {
  if (run.phase !== "scanning") return run;
  const started = Date.now();
  const budget = deps.timeBudgetMs ?? 40_000;
  outer: while (Date.now() - started < budget) {
    const accounts = await accountsToPush(run.cursor, PAGE);
    if (!accounts.length) {
      run.phase = "review";
      break;
    }
    for (const a of accounts) {
      if (Date.now() - started >= budget) break outer;
      await addRows(run, [await proposeFor(a, deps.sf)]);
      run.scanned++;
      run.cursor = a.id;
    }
  }
  if (run.phase === "review") run.cursor = null;
  return saveRun(run);
}

async function applyRow(row: MappingRow, run: MappingRun, deps: SalesforcePushDeps): Promise<string> {
  const { action, targetId } = finalChoice(row);
  if (action === "skip") return "Skipped";
  const account = await getClient(row.sourceId);
  if (!account) throw new Error("The app Account no longer exists");
  const actor = run.confirmedBy ?? "system";
  if (action === "link") {
    if (!targetId) throw new Error("No Salesforce Account chosen");
    const [a] = await deps.sf.query<{ Id: string; Name: string }>(`SELECT Id, Name FROM Account WHERE Id = ${soqlString(targetId)} LIMIT 1`);
    if (!a) throw new Error("That Salesforce Account no longer exists");
    if (account.sfAccountId && account.sfAccountId !== a.Id) throw new Error("This Account is linked to a different Salesforce Account");
    await setClientSalesforce(account.id, { sfAccountId: a.Id, sfStatus: "linked", sfLastError: null });
  } else {
    await setClientSalesforce(account.id, { sfStatus: "create_confirmed", sfLastError: null });
  }
  const apps = await pendingApplications(account.id);
  for (const app of apps) await enqueueSalesforceSync(app.id);
  await addClientEvent(account.id, "sf_linked", actor, {
    message: `${action === "link" ? `Linked to Salesforce Account ${targetId}` : "Confirmed as a new Salesforce Account"} on the mapping screen; ${apps.length} application${apps.length === 1 ? "" : "s"} queued`,
  });
  return `${action === "link" ? "Linked" : "New Account confirmed"}; ${apps.length} application${apps.length === 1 ? "" : "s"} queued`;
}

export async function applyPushBatch(run: MappingRun, deps: SalesforcePushDeps): Promise<MappingRun> {
  return applyBatch(run, (row) => applyRow(row, run, deps), deps.timeBudgetMs);
}
