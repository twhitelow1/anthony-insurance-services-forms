import "server-only";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Client, MappingRow } from "@/lib/db/schema";
import { addClientEvent, clientsForCompany, contactEmailsOf, getClient, listAccountContacts, setClientSalesforce, setContactGhl } from "@/lib/clients/repo";
import { nameKey, websiteDomain } from "@/lib/clients/text";
import {
  addContactsToBusiness,
  createBusiness,
  findContactByEmail,
  getContact as getGhlContact,
  listBusinesses,
  upsertContact,
  type GhlBusiness,
} from "@/lib/ghl/client";
import { addRows, applyBatch, finalChoice, saveRun, type MappingRun, type NewMappingRow } from "./runs";

/**
 * App Accounts → Lead Alchemist Companies (the API calls them "businesses"). The scan reads
 * every Company once and proposes, per app Account:
 * - link (exact): already linked to that Company;
 * - link (strong): one Company with the same name (ignoring punctuation and LLC/Inc), or the same website;
 * - link (name_only): several Companies share the name: staff pick one;
 * - create: no Company like it yet;
 * - skip: individuals (no business), unless staff choose otherwise.
 * Applying creates or links the Company and puts the Account's Contacts in it. A contact
 * can only be in one Company, so contacts already in a different Company are left there
 * unless "move" was chosen. Contacts not yet in Lead Alchemist are only created when
 * "create missing contacts" was chosen (creating contacts can start Lead Alchemist workflows).
 */
const PAGE = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LaCompaniesDeps {
  /** Every Company in the sub-account; loaded once per batch. Injectable for tests. */
  businesses?: () => Promise<GhlBusiness[]>;
  timeBudgetMs?: number;
  paceMs?: number;
}

function indexBusinesses(list: GhlBusiness[]) {
  const byId = new Map(list.map((b) => [b.id, b]));
  const byKey = new Map<string, GhlBusiness[]>();
  const bySite = new Map<string, GhlBusiness[]>();
  for (const b of list) {
    const k = nameKey(b.name);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), b]);
    const site = websiteDomain(b.website);
    if (site) bySite.set(site, [...(bySite.get(site) ?? []), b]);
  }
  return { byId, byKey, bySite };
}

export async function proposeForClient(account: Client, idx: ReturnType<typeof indexBusinesses>): Promise<NewMappingRow> {
  const people = (await listAccountContacts(account.id)).filter((p) => p.homeHere);
  const db = await getDb();
  const applications = await db.$count(schema.applications, eq(schema.applications.clientId, account.id));
  const base = {
    sourceId: account.id,
    sourceName: account.name,
    sourceDetail: {
      phone: account.phones[0] ?? null,
      website: account.website,
      city: account.address?.city ?? null,
      state: account.address?.state ?? null,
      sfAccountId: account.sfAccountId,
      ghlCompanyId: account.ghlCompanyId,
      applications,
      contacts: await Promise.all(
        people.map(async (p) => ({ name: p.name, email: p.primaryEmail ?? (await contactEmailsOf(p.id))[0] ?? null, inLa: !!p.ghlContactId })),
      ),
    },
  };
  const toCandidate = (b: GhlBusiness, note: string) => ({ id: b.id, name: b.name, note });

  if (account.ghlCompanyId && idx.byId.has(account.ghlCompanyId)) {
    const b = idx.byId.get(account.ghlCompanyId)!;
    return { ...base, proposal: "link", confidence: "exact", targetId: b.id, targetName: b.name, reason: "Already linked to this Company" };
  }
  const sameName = idx.byKey.get(account.nameKey || nameKey(account.name)) ?? [];
  const site = websiteDomain(account.website);
  const sameSite = site ? (idx.bySite.get(site) ?? []) : [];
  const candidates = [...new Map([...sameName, ...sameSite].map((b) => [b.id, b])).values()]
    .slice(0, 8)
    .map((b) => toCandidate(b, sameSite.includes(b) && sameName.includes(b) ? "same name and website" : sameSite.includes(b) ? "same website" : "same name"));

  if (account.isIndividual) {
    return { ...base, proposal: "skip", confidence: "none", reason: "An individual (no business name): no Company needed", candidates };
  }
  if (sameName.length === 1) {
    return { ...base, proposal: "link", confidence: "strong", targetId: sameName[0].id, targetName: sameName[0].name, reason: "One Company with the same name", candidates };
  }
  if (sameSite.length === 1) {
    return { ...base, proposal: "link", confidence: "strong", targetId: sameSite[0].id, targetName: sameSite[0].name, reason: "One Company with the same website", candidates };
  }
  if (candidates.length) {
    const first = sameName[0] ?? sameSite[0];
    return { ...base, proposal: "link", confidence: "name_only", targetId: first.id, targetName: first.name, reason: `${candidates.length} Companies look like this one: pick the right one`, candidates };
  }
  return { ...base, proposal: "create", confidence: "none", reason: "No Company like it in Lead Alchemist yet" };
}

/** Propose a Company for the next app Accounts. Time-boxed; call again until review. */
export async function scanCompaniesBatch(run: MappingRun, deps: LaCompaniesDeps = {}): Promise<MappingRun> {
  if (run.phase !== "scanning") return run;
  const idx = indexBusinesses(await (deps.businesses ?? (() => listBusinesses()))());
  const db = await getDb();
  const started = Date.now();
  const budget = deps.timeBudgetMs ?? 40_000;
  while (Date.now() - started < budget) {
    const accounts = await db
      .select()
      .from(schema.clients)
      .where(and(isNull(schema.clients.mergedInto), run.cursor ? gt(schema.clients.id, run.cursor) : undefined))
      .orderBy(asc(schema.clients.id))
      .limit(PAGE);
    if (!accounts.length) {
      run.phase = "review";
      break;
    }
    const rows: NewMappingRow[] = [];
    for (const a of accounts) rows.push(await proposeForClient(a, idx));
    await addRows(run, rows);
    run.scanned += accounts.length;
    run.cursor = accounts.at(-1)!.id;
    if (accounts.length < PAGE) {
      run.phase = "review";
      break;
    }
  }
  if (run.phase === "review") run.cursor = null;
  return saveRun(run);
}

async function applyRow(row: MappingRow, run: MappingRun, deps: LaCompaniesDeps): Promise<string> {
  const { action, targetId } = finalChoice(row);
  if (action === "skip") return "Skipped";
  const account = await getClient(row.sourceId);
  if (!account) throw new Error("The app Account no longer exists");
  const actor = run.confirmedBy ?? "system";
  const pace = deps.paceMs ?? 120;

  let companyId: string;
  if (action === "link") {
    if (!targetId) throw new Error("No Company chosen");
    const others = (await clientsForCompany(targetId)).filter((c) => c.id !== account.id);
    if (others.length) throw new Error(`That Company is already linked to the app Account "${others[0].name}": merge the two Accounts first`);
    companyId = targetId;
  } else {
    const people = await listAccountContacts(account.id);
    const created = await createBusiness({
      name: account.name,
      phone: account.phones[0] ?? null,
      email: account.primaryEmail ?? people.find((p) => p.primaryEmail)?.primaryEmail ?? null,
      website: account.website,
      address: account.address?.street ?? null,
      city: account.address?.city ?? null,
      state: account.address?.state ?? null,
      postalCode: account.address?.postalCode ?? null,
      country: "US",
    });
    companyId = created.id;
  }
  await setClientSalesforce(account.id, { ghlCompanyId: companyId });

  // The Account's own Contacts go into the Company.
  const people = (await listAccountContacts(account.id)).filter((p) => p.homeHere);
  const toAdd: string[] = [];
  let notInLa = 0;
  let inOther = 0;
  let createdContacts = 0;
  for (const p of people) {
    let ghlId = p.ghlContactId;
    const email = p.primaryEmail ?? (await contactEmailsOf(p.id))[0] ?? null;
    if (!ghlId && email) {
      ghlId = (await findContactByEmail(email))?.id ?? null;
      await sleep(pace);
    }
    if (!ghlId && email && run.options.createContacts) {
      const res = await upsertContact({ email, firstName: p.firstName ?? undefined, lastName: p.lastName ?? undefined, phone: p.phones[0], companyName: account.name, source: "Online Applications App" });
      ghlId = res.contact.id;
      createdContacts++;
      await sleep(pace);
    }
    if (!ghlId) {
      notInLa++;
      continue;
    }
    if (ghlId !== p.ghlContactId) await setContactGhl(p.id, ghlId);
    const current = await getGhlContact(ghlId);
    await sleep(pace);
    if (current?.businessId && current.businessId !== companyId && !run.options.moveContacts) {
      inOther++;
      continue;
    }
    if (current?.businessId !== companyId) toAdd.push(ghlId);
  }
  if (toAdd.length) await addContactsToBusiness(toAdd, companyId);

  await addClientEvent(account.id, "la_company_linked", actor, {
    message: `${action === "link" ? "Linked to" : "Created"} Lead Alchemist Company ${companyId}; ${toAdd.length} contact${toAdd.length === 1 ? "" : "s"} added`,
  });
  return [
    `${action === "link" ? "Linked" : "Created Company"}`,
    `${toAdd.length} contact${toAdd.length === 1 ? "" : "s"} added`,
    createdContacts ? `${createdContacts} created in Lead Alchemist` : null,
    inOther ? `${inOther} left in another Company` : null,
    notInLa ? `${notInLa} not in Lead Alchemist` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

export async function applyCompaniesBatch(run: MappingRun, deps: LaCompaniesDeps = {}): Promise<MappingRun> {
  return applyBatch(run, (row) => applyRow(row, run, deps), deps.timeBudgetMs);
}
