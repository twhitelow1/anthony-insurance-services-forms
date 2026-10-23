import "server-only";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { BackfillOutcome } from "@/lib/db/schema";
import {
  addClientEvent,
  attachEmail,
  clientGhlContactId,
  clientsForAccount,
  ensureClient,
  getClient,
  getClientIdForEmail,
  normalizeEmail,
  setClientSalesforce,
} from "@/lib/clients/repo";
import { toCsv } from "@/lib/clients/text";
import type { Links } from "@/lib/integrations/urls";
import { soqlString, type SalesforceApi } from "./api";
import { LINK_FIELDS, prepareFields } from "./mapping";

/**
 * One-time backfill: read every Salesforce Account and its Contacts, link each to the app's
 * client with the same email (creating the client if there's none), and write the new link
 * fields (Applications_Link__c, LA_Contact_Link__c) back to Salesforce.
 *
 * - Always run a dry run first: it writes nothing anywhere and produces the CSV report
 *   (matched, new, ambiguous, skipped) for Todd to review.
 * - Applying writes only the link fields in Salesforce; it never deletes or changes anything else.
 * - Resumable: progress (the last Account ID) is saved after every Account, and each call does
 *   one time-boxed batch. Paced, and stops if the org's daily API use passes 80%.
 */
export type BackfillMode = "dry_run" | "apply";

export interface BackfillState {
  runId: string;
  mode: BackfillMode;
  lastId: string | null;
  done: boolean;
  counts: Record<BackfillOutcome, number>;
  startedAt: string;
  updatedAt: string;
  stoppedReason?: string;
}

const STATE_KEY = "salesforce_backfill_state";
const PAGE = 200;
const emptyCounts = (): Record<BackfillOutcome, number> => ({ matched: 0, new: 0, ambiguous: 0, skipped: 0, error: 0 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getBackfillState(): Promise<BackfillState | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, STATE_KEY)).limit(1);
  return (row?.value as BackfillState) ?? null;
}

async function saveState(state: BackfillState, actor: string) {
  const db = await getDb();
  const value = { ...state, updatedAt: new Date().toISOString() };
  await db
    .insert(schema.appSettings)
    .values({ key: STATE_KEY, value, updatedBy: actor })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedBy: actor, updatedAt: new Date() } });
}

/** Start a new run (a dry run, or applying for real). */
export async function startBackfill(mode: BackfillMode, actor: string): Promise<BackfillState> {
  const now = new Date().toISOString();
  const state: BackfillState = { runId: randomUUID(), mode, lastId: null, done: false, counts: emptyCounts(), startedAt: now, updatedAt: now };
  await saveState(state, actor);
  return state;
}

type ContactRow = { Id: string; Email: string | null; FirstName: string | null; LastName: string | null; Phone: string | null } & Record<string, unknown>;
type AccountRow = {
  Id: string;
  Name: string;
  Phone: string | null;
  BillingStreet?: string | null;
  BillingCity?: string | null;
  BillingState?: string | null;
  BillingPostalCode?: string | null;
  Contacts?: { records: ContactRow[] } | null;
} & Record<string, unknown>;

interface Decision {
  outcome: BackfillOutcome;
  clientId: string | null;
  note: string;
}

export interface BackfillDeps {
  sf: SalesforceApi;
  links: Links;
  /** Wait between Salesforce writes (ms). */
  paceMs?: number;
  /** Stop the batch after this long (ms), to stay inside a serverless request. */
  timeBudgetMs?: number;
}

/** What to do with one Account, given the app's clients. Pure lookups; writes nothing. */
async function decide(account: AccountRow, emails: string[]): Promise<Decision> {
  if (!emails.length) return { outcome: "skipped", clientId: null, note: "No Contact with an email on this Account" };
  const linked = await clientsForAccount(account.Id);
  const byEmail = [...new Set((await Promise.all(emails.map(getClientIdForEmail))).filter((id): id is string => !!id))];
  const candidates = [...new Set([...linked.map((c) => c.id), ...byEmail])];
  if (candidates.length > 1) {
    return { outcome: "ambiguous", clientId: null, note: `${candidates.length} app clients share this Account's emails; merge them in Admin → Clients first` };
  }
  if (candidates.length === 1) {
    const client = await getClient(candidates[0]);
    if (client?.sfAccountId && client.sfAccountId !== account.Id) {
      return { outcome: "ambiguous", clientId: client.id, note: "This client is already linked to a different Salesforce Account" };
    }
    return { outcome: "matched", clientId: candidates[0], note: client?.sfAccountId === account.Id ? "Already linked" : "Matched by Contact email" };
  }
  return { outcome: "new", clientId: null, note: "No app client with these emails yet; one is created" };
}

/**
 * Process Accounts until the time budget runs out or there are none left. Returns the updated state.
 * Safe to call repeatedly; it continues from the saved last Account ID.
 */
export async function runBackfillBatch(deps: BackfillDeps, actor: string): Promise<BackfillState> {
  const state = await getBackfillState();
  if (!state) throw new Error("Start a dry run first.");
  if (state.done) return state;
  const db = await getDb();
  const started = Date.now();
  const budget = deps.timeBudgetMs ?? 40_000;
  const pace = deps.paceMs ?? 150;
  const apply = state.mode === "apply";

  const [accountDescribe, contactDescribe] = await Promise.all([deps.sf.describe("Account"), deps.sf.describe("Contact")]);
  const has = (d: { fields: { name: string }[] }, n: string) => d.fields.some((f) => f.name === n);
  const appLinkField = LINK_FIELDS.Account.applications;
  const accountLinkFields: string[] = [appLinkField, LINK_FIELDS.Account.laContact].filter((f) => has(accountDescribe, f));
  const contactLinkFields: string[] = [LINK_FIELDS.Contact.applications, LINK_FIELDS.Contact.laContact].filter((f) => has(contactDescribe, f));

  while (Date.now() - started < budget) {
    const where = state.lastId ? `WHERE Id > ${soqlString(state.lastId)} ` : "";
    const soql =
      `SELECT Id, Name, Phone, BillingStreet, BillingCity, BillingState, BillingPostalCode${accountLinkFields.length ? `, ${accountLinkFields.join(", ")}` : ""}, ` +
      `(SELECT Id, Email, FirstName, LastName, Phone${contactLinkFields.length ? `, ${contactLinkFields.join(", ")}` : ""} FROM Contacts WHERE Email != null ORDER BY CreatedDate) ` +
      `FROM Account ${where}ORDER BY Id LIMIT ${PAGE}`;
    const { records } = await deps.sf.queryPage<AccountRow>(soql);
    if (!records.length) {
      state.done = true;
      break;
    }
    for (const account of records) {
      if (Date.now() - started >= budget) break;
      const usage = deps.sf.usage();
      if (usage && usage.used / usage.max > 0.8) {
        state.stoppedReason = `Paused: Salesforce API use is at ${usage.used} of ${usage.max} for today. Continue tomorrow.`;
        await saveState(state, actor);
        return state;
      }
      const contacts = (account.Contacts?.records ?? []).filter((c) => c.Email);
      const emails = [...new Set(contacts.map((c) => normalizeEmail(c.Email!)))];
      let d: Decision;
      try {
        d = await decide(account, emails);
        if (apply && (d.outcome === "matched" || d.outcome === "new")) {
          const first = contacts[0];
          const clientId =
            d.clientId ??
            (await ensureClient({
              email: emails[0],
              businessName: account.Name,
              contactName: [first?.FirstName, first?.LastName].filter(Boolean).join(" ") || null,
              phone: account.Phone ?? first?.Phone,
              address: { street: account.BillingStreet ?? undefined, city: account.BillingCity ?? undefined, state: account.BillingState ?? undefined, postalCode: account.BillingPostalCode ?? undefined },
            }));
          d.clientId = clientId;
          // The Account's other contact emails join the client (unless another client has them).
          for (const e of emails.slice(1)) await attachEmail(clientId, e);
          const primary = contacts.find((c) => normalizeEmail(c.Email!) === emails[0]);
          await setClientSalesforce(clientId, { sfAccountId: account.Id, sfContactId: primary?.Id ?? null, sfStatus: "linked", sfLastError: null });
          // Only the link fields, and only when they'd change.
          const ghlContactId = await clientGhlContactId(clientId);
          const wanted: Record<string, string | null> = {
            [appLinkField]: deps.links.appClient(clientId),
            [LINK_FIELDS.Account.laContact]: deps.links.ghlContact(ghlContactId),
          };
          const changed = Object.fromEntries(Object.entries(wanted).filter(([f, v]) => v && accountLinkFields.includes(f) && account[f] !== v));
          const { data } = prepareFields(accountDescribe, changed, "update");
          if (Object.keys(data).length) {
            await deps.sf.update("Account", account.Id, data);
            await sleep(pace);
          }
          for (const c of contacts) {
            const cData = prepareFields(
              contactDescribe,
              Object.fromEntries(
                Object.entries({
                  [LINK_FIELDS.Contact.applications]: deps.links.appClient(clientId),
                  [LINK_FIELDS.Contact.laContact]: deps.links.ghlContact(ghlContactId),
                }).filter(([f, v]) => v && contactLinkFields.includes(f) && c[f] !== v),
              ),
              "update",
            ).data;
            if (Object.keys(cData).length) {
              await deps.sf.update("Contact", c.Id, cData);
              await sleep(pace);
            }
          }
          await addClientEvent(clientId, "sf_linked", actor, { message: `Linked to Salesforce Account ${account.Id} by the backfill (${d.note.toLowerCase()})` });
        }
      } catch (err) {
        d = { outcome: "error", clientId: null, note: err instanceof Error ? err.message : String(err) };
      }
      await db.insert(schema.salesforceBackfillRows).values({
        runId: state.runId,
        mode: state.mode,
        accountId: account.Id,
        accountName: account.Name,
        emails,
        outcome: d.outcome,
        clientId: d.clientId,
        note: d.note,
      });
      state.counts[d.outcome]++;
      state.lastId = account.Id;
      await saveState(state, actor);
    }
    // A short page that was fully processed is the end of the Accounts.
    if (records.length < PAGE && state.lastId === records.at(-1)!.Id) {
      state.done = true;
      break;
    }
  }
  state.stoppedReason = undefined;
  await saveState(state, actor);
  console.info(`[salesforce] backfill ${state.mode} ${state.runId}: ${JSON.stringify(state.counts)}${state.done ? " (done)" : ""}`);
  return state;
}

export const BACKFILL_CSV_HEADER = ["Outcome", "Salesforce Account ID", "Account name", "Contact emails", "Client page", "Note", "Mode"];

/** The run's report, for review before applying. */
export async function backfillReportCsv(runId: string, links: Links): Promise<string> {
  const db = await getDb();
  const rows = await db.select().from(schema.salesforceBackfillRows).where(eq(schema.salesforceBackfillRows.runId, runId)).orderBy(asc(schema.salesforceBackfillRows.id));
  return toCsv(
    BACKFILL_CSV_HEADER,
    rows.map((r) => [r.outcome, r.accountId, r.accountName, r.emails.join("; "), links.appClient(r.clientId), r.note, r.mode === "dry_run" ? "dry run" : "applied"]),
  );
}
