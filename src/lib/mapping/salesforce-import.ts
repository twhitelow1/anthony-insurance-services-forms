import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Client, MappingDetail, MappingRow } from "@/lib/db/schema";
import {
  accountsByNameKey,
  addClientEvent,
  clientGhlContactId,
  clientsForAccount,
  createAccount,
  ensureContact,
  getClient,
  getContactByEmail,
  isStrongMatch,
  normalizeEmail,
  refreshSearch,
  setClientSalesforce,
} from "@/lib/clients/repo";
import { nameKey } from "@/lib/clients/text";
import type { Links } from "@/lib/integrations/urls";
import { soqlString, type SalesforceApi } from "@/lib/salesforce/api";
import { LINK_FIELDS, prepareFields } from "@/lib/salesforce/mapping";
import { addRows, applyBatch, finalChoice, saveRun, type MappingRun, type NewMappingRow } from "./runs";

/**
 * Salesforce → app: every Salesforce Account (and its Contacts) becomes an app Account.
 * The scan only reads Salesforce and proposes, per Account:
 * - link (exact): an app Account is already linked to it;
 * - link (strong): one of its Contacts' emails belongs to an app Contact, or an app business
 *   Account has the same name and the same phone or website;
 * - create (name_only): app Accounts share its name but nothing else: staff decide;
 * - create (none): nothing like it in the app yet.
 * Applying (after staff confirm) links or creates the Account, adds its Contacts, and writes
 * the app's link back onto the Salesforce Account and Contacts (only the link fields).
 */
type ContactRow = { Id: string; Email: string | null; FirstName: string | null; LastName: string | null; Phone: string | null; Title: string | null } & Record<string, unknown>;
type AccountRow = {
  Id: string;
  Name: string;
  Phone: string | null;
  Website: string | null;
  BillingStreet: string | null;
  BillingCity: string | null;
  BillingState: string | null;
  BillingPostalCode: string | null;
  Contacts?: { records: ContactRow[] } | null;
} & Record<string, unknown>;

const PAGE = 200;

export interface SalesforceImportDeps {
  sf: SalesforceApi;
  links: Links;
  timeBudgetMs?: number;
}

/** What to propose for one Salesforce Account. Reads the app only. */
export async function proposeForAccount(account: AccountRow): Promise<NewMappingRow> {
  const contacts = account.Contacts?.records ?? [];
  const detail: MappingDetail = {
    phone: account.Phone,
    website: account.Website,
    street: account.BillingStreet,
    city: account.BillingCity,
    state: account.BillingState,
    postalCode: account.BillingPostalCode,
    contacts: contacts.map((c) => ({
      name: [c.FirstName, c.LastName].filter(Boolean).join(" ") || c.Email || "Unnamed",
      email: c.Email ? normalizeEmail(c.Email) : null,
      sfId: c.Id,
      firstName: c.FirstName,
      lastName: c.LastName,
      phone: c.Phone,
      title: c.Title,
    })),
  };
  const base = { sourceId: account.Id, sourceName: account.Name, sourceDetail: detail };

  const linked = await clientsForAccount(account.Id);
  if (linked.length) return { ...base, proposal: "link", confidence: "exact", targetId: linked[0].id, targetName: linked[0].name, reason: "Already linked to this Salesforce Account" };

  // Contacts' emails that already belong to app Contacts → their home Accounts.
  const byEmail = new Map<string, Client>();
  for (const c of detail.contacts ?? []) {
    if (!c.email) continue;
    const contact = await getContactByEmail(c.email);
    const home = contact ? await getClient(contact.clientId) : undefined;
    if (home && !home.sfAccountId) byEmail.set(home.id, home);
  }
  const key = nameKey(account.Name);
  const sameName = (await accountsByNameKey(key)).filter((a) => !a.sfAccountId);
  const strongByName: Client[] = [];
  for (const a of sameName) if (await isStrongMatch(a, { email: "", phone: account.Phone, website: account.Website })) strongByName.push(a);

  const candidates = [...new Map([...byEmail.values(), ...sameName].map((a) => [a.id, a])).values()].slice(0, 8).map((a) => ({
    id: a.id,
    name: a.name,
    note: byEmail.has(a.id) ? "a Contact's email matches" : strongByName.includes(a) ? "same name and phone/website" : "same name only",
  }));

  // An email match on an Account whose name is clearly the same business is the strongest signal.
  const emailSameName = [...byEmail.values()].filter((a) => a.nameKey === key || a.isIndividual);
  if (emailSameName.length === 1) {
    const a = emailSameName[0];
    return { ...base, proposal: "link", confidence: "strong", targetId: a.id, targetName: a.name, reason: "A Contact's email belongs to this app Account", candidates };
  }
  if (strongByName.length === 1) {
    const a = strongByName[0];
    return { ...base, proposal: "link", confidence: "strong", targetId: a.id, targetName: a.name, reason: "Same name and the same phone or website", candidates };
  }
  if (candidates.length) {
    return {
      ...base,
      proposal: "create",
      confidence: "name_only",
      reason: byEmail.size ? "A Contact's email is on an app Account with a different name: check" : "App Accounts share this name but nothing else: check",
      candidates,
    };
  }
  return { ...base, proposal: "create", confidence: "none", reason: "Not in the app yet" };
}

/** Read the next Salesforce Accounts and add their proposed rows. Time-boxed; call again until review. */
export async function scanSalesforceBatch(run: MappingRun, deps: SalesforceImportDeps): Promise<MappingRun> {
  if (run.phase !== "scanning") return run;
  const started = Date.now();
  const budget = deps.timeBudgetMs ?? 40_000;
  while (Date.now() - started < budget) {
    const where = run.cursor ? `WHERE Id > ${soqlString(run.cursor)} ` : "";
    const soql =
      "SELECT Id, Name, Phone, Website, BillingStreet, BillingCity, BillingState, BillingPostalCode, " +
      "(SELECT Id, Email, FirstName, LastName, Phone, Title FROM Contacts ORDER BY CreatedDate) " +
      `FROM Account ${where}ORDER BY Id LIMIT ${PAGE}`;
    const { records } = await deps.sf.queryPage<AccountRow>(soql);
    if (!records.length) {
      run.phase = "review";
      break;
    }
    const rows: NewMappingRow[] = [];
    for (const account of records) rows.push(await proposeForAccount(account));
    await addRows(run, rows);
    run.scanned += records.length;
    run.cursor = records.at(-1)!.Id;
    if (records.length < PAGE) {
      run.phase = "review";
      break;
    }
    const usage = deps.sf.usage();
    if (usage && usage.used / usage.max > 0.8) {
      run.stoppedReason = `Paused: Salesforce API use is at ${usage.used} of ${usage.max} for today. Continue tomorrow.`;
      break;
    }
  }
  if (run.phase === "review") run.cursor = null;
  return saveRun(run);
}

/** Apply one confirmed row. Returns what happened, for the row's result column. */
async function applyRow(row: MappingRow, deps: SalesforceImportDeps, actor: string): Promise<string> {
  const { action, targetId } = finalChoice(row);
  if (action === "skip") return "Skipped";
  const d = row.sourceDetail;
  const address = { street: d.street ?? undefined, city: d.city ?? undefined, state: d.state ?? undefined, postalCode: d.postalCode ?? undefined };

  let account: Client;
  if (action === "link") {
    const target = targetId ? await getClient(targetId) : undefined;
    if (!target) throw new Error("The app Account to link to no longer exists");
    if (target.sfAccountId && target.sfAccountId !== row.sourceId) throw new Error(`"${target.name}" is already linked to a different Salesforce Account`);
    await setClientSalesforce(target.id, { sfAccountId: row.sourceId, sfStatus: "linked", sfLastError: null });
    // Fill in what the app doesn't have yet.
    const fill = { ...(!target.website && d.website ? { website: d.website } : {}), ...(!target.address && Object.values(address).some(Boolean) ? { address } : {}) };
    if (Object.keys(fill).length) await (await getDb()).update(schema.clients).set(fill).where(eq(schema.clients.id, target.id));
    account = target;
  } else {
    account = await createAccount({ name: row.sourceName, phone: d.phone, website: d.website, address, sfAccountId: row.sourceId }, actor);
  }

  let added = 0;
  for (const c of d.contacts ?? []) {
    const before = c.email ? await getContactByEmail(c.email) : undefined;
    await ensureContact({ clientId: account.id, email: c.email, firstName: c.firstName, lastName: c.lastName, name: c.name, title: c.title, phone: c.phone, sfContactId: c.sfId });
    if (!before) added++;
  }
  await refreshSearch(account.id);
  await addClientEvent(account.id, "imported", actor, {
    message: `${action === "link" ? "Linked to" : "Imported from"} Salesforce Account ${row.sourceId}${d.contacts?.length ? ` with ${d.contacts.length} contact${d.contacts.length === 1 ? "" : "s"}` : ""}`,
  });
  await writeLinksBack(row, account.id, deps);
  return `${action === "link" ? "Linked" : "Created"} "${account.name}"${added ? `, ${added} new contact${added === 1 ? "" : "s"}` : ""}`;
}

/** Only the link fields, and only when they'd change. Missing fields are skipped. */
async function writeLinksBack(row: MappingRow, clientId: string, deps: SalesforceImportDeps) {
  const [accountDescribe, contactDescribe] = await Promise.all([deps.sf.describe("Account"), deps.sf.describe("Contact")]);
  const ghlContactId = await clientGhlContactId(clientId);
  const page = deps.links.appClient(clientId);
  const laContact = deps.links.ghlContact(ghlContactId);
  const { data } = prepareFields(accountDescribe, { [LINK_FIELDS.Account.applications]: page, [LINK_FIELDS.Account.laContact]: laContact }, "update");
  if (Object.keys(data).length) await deps.sf.update("Account", row.sourceId, data);
  for (const c of row.sourceDetail.contacts ?? []) {
    if (!c.sfId) continue;
    const cData = prepareFields(contactDescribe, { [LINK_FIELDS.Contact.applications]: page }, "update").data;
    if (Object.keys(cData).length) await deps.sf.update("Contact", c.sfId, cData);
  }
}

export async function applySalesforceBatch(run: MappingRun, deps: SalesforceImportDeps): Promise<MappingRun> {
  return applyBatch(run, (row) => applyRow(row, deps, run.confirmedBy ?? "system"), deps.timeBudgetMs);
}
