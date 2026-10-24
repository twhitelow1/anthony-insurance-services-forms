import { describe, expect, it, vi } from "vitest";
import { linksFor } from "@/lib/integrations/urls";
import { mockSalesforce } from "@/test/salesforce-mock";
import { clientsForAccount, getClient, getContactByEmail, listAccountContacts, resolveAccountAndContact } from "@/lib/clients/repo";
import { confirmRun, getRun, listRows, saveDecisions, startRun, summarize } from "./runs";
import { applySalesforceBatch, scanSalesforceBatch } from "./salesforce-import";
import { applyCompaniesBatch, scanCompaniesBatch } from "./la-companies";

// Lead Alchemist stand-in: Companies and contacts held in memory.
const la = vi.hoisted(() => ({
  businesses: [] as { id: string; name: string; website?: string | null }[],
  contacts: new Map<string, { id: string; email: string; businessId?: string | null }>(),
  attached: [] as { ids: string[]; businessId: string }[],
  created: [] as string[],
}));
vi.mock("@/lib/ghl/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/ghl/client")>()),
  listBusinesses: async () => la.businesses,
  createBusiness: async (input: { name: string }) => {
    const b = { id: `biz${la.businesses.length + 1}`, name: input.name };
    la.businesses.push(b);
    la.created.push(input.name);
    return b;
  },
  findContactByEmail: async (email: string) => [...la.contacts.values()].find((c) => c.email === email) ?? null,
  getContact: async (id: string) => la.contacts.get(id) ?? null,
  upsertContact: async (input: { email: string }) => {
    const c = { id: `con${la.contacts.size + 1}`, email: input.email };
    la.contacts.set(c.id, c);
    return { new: true, contact: { id: c.id } };
  },
  addContactsToBusiness: async (ids: string[], businessId: string) => {
    la.attached.push({ ids, businessId });
    for (const id of ids) la.contacts.get(id)!.businessId = businessId;
  },
}));

const LINKS = linksFor({ salesforce: "https://org.lightning.force.com", ghl: "https://app.leadalchemist.io", ghlLocationId: "LOC1", app: "https://forms.example.com" });
const uniq = () => Math.random().toString(36).slice(2, 8);

describe("Salesforce Accounts → app accounts", () => {
  it("proposes link / create / check, lets staff change a row, and writes nothing until confirmed", async () => {
    const tag = uniq();
    const sf = mockSalesforce();
    // In the app already: a person (by email) and a same-named business with a different phone.
    const known = await resolveAccountAndContact({ email: `owner.${tag}@gmail.com`, contactName: "Owner", businessName: `Bounce Barn ${tag}`, phone: "555-100-0000" });
    const lookalike = await resolveAccountAndContact({ email: `x.${tag}@gmail.com`, businessName: `Twin Gym ${tag}`, phone: "555-200-0000" });

    const a = await sf.api.create("Account", { Name: `Bounce Barn ${tag}, LLC`, Phone: "555-999-0000" });
    await sf.api.create("Contact", { AccountId: a.id, Email: `owner.${tag}@gmail.com`, FirstName: "Own", LastName: "Er" });
    const b = await sf.api.create("Account", { Name: `Brand New ${tag}`, Phone: "555-300-0000" });
    await sf.api.create("Contact", { AccountId: b.id, Email: `new.${tag}@gmail.com`, FirstName: "Nu", LastName: "Person" });
    const c = await sf.api.create("Account", { Name: `Twin Gym ${tag}`, Phone: "555-777-0000" });
    const writesBefore = sf.writes.length;

    let run = await startRun("salesforce_import", "staff:amy@anthonyinsuranceservices.com");
    run = await scanSalesforceBatch(run, { sf: sf.api, links: LINKS });
    expect(run.phase).toBe("review");
    expect(sf.writes.length).toBe(writesBefore); // the scan only reads
    const { rows } = await listRows(run.runId);
    const row = (id: string) => rows.find((r) => r.sourceId === id)!;
    expect(row(a.id)).toMatchObject({ proposal: "link", confidence: "strong", targetId: known.clientId });
    expect(row(b.id)).toMatchObject({ proposal: "create", confidence: "none" });
    expect(row(c.id)).toMatchObject({ proposal: "create", confidence: "name_only" });
    expect(row(c.id).candidates.map((x) => x.id)).toContain(lookalike.clientId);
    expect((await clientsForAccount(a.id)).length).toBe(0);

    // Staff: Twin Gym is the same business after all. A target that wasn't offered is ignored.
    expect(await saveDecisions(run.runId, { [row(c.id).id]: `link:${lookalike.clientId}`, [row(b.id).id]: "link:not-a-candidate" })).toBe(1);
    expect((await summarize(run.runId))).toMatchObject({ link: 2, create: 1 });

    run = await confirmRun("salesforce_import", "staff:amy@anthonyinsuranceservices.com");
    run = await applySalesforceBatch(run, { sf: sf.api, links: LINKS });
    expect(run.phase).toBe("done");
    expect((await getClient(known.clientId))!.sfAccountId).toBe(a.id);
    expect((await getClient(lookalike.clientId))!.sfAccountId).toBe(c.id);
    const created = (await clientsForAccount(b.id))[0];
    expect(created).toMatchObject({ name: `Brand New ${tag}`, isIndividual: false });
    expect((await listAccountContacts(created.id)).map((p) => p.name)).toEqual(["Nu Person"]);
    expect((await getContactByEmail(`new.${tag}@gmail.com`))!.sfContactId).toBeTruthy();
    // The app's link went back onto the Salesforce Account.
    expect(sf.records.Account.find((x) => x.Id === b.id)!.Applications_Link__c).toBe(`https://forms.example.com/admin/clients/${created.id}`);
    expect((await getRun("salesforce_import"))!.applied).toBe(3);
  });
});

describe("app accounts → Lead Alchemist Companies", () => {
  it("links by name, creates the rest, and only moves contacts when asked", async () => {
    const tag = uniq();
    const one = await resolveAccountAndContact({ email: `one.${tag}@gmail.com`, contactName: "One", businessName: `Aerial Co ${tag}` });
    const two = await resolveAccountAndContact({ email: `two.${tag}@gmail.com`, contactName: "Two", businessName: `Fresh Dance ${tag}` });
    const solo = await resolveAccountAndContact({ email: `solo.${tag}@gmail.com`, contactName: "Solo Instructor" });
    la.businesses.push({ id: `existing-${tag}`, name: `Aerial Co., LLC ${tag}`.replace(`, LLC ${tag}`, ` ${tag} LLC`) });
    la.contacts.set(`c1-${tag}`, { id: `c1-${tag}`, email: `one.${tag}@gmail.com` });
    la.contacts.set(`c2-${tag}`, { id: `c2-${tag}`, email: `two.${tag}@gmail.com`, businessId: "someone-elses-company" });

    let run = await startRun("la_companies", "staff:amy@anthonyinsuranceservices.com");
    run = await scanCompaniesBatch(run);
    expect(run.phase).toBe("review");
    const { rows } = await listRows(run.runId);
    const row = (id: string) => rows.find((r) => r.sourceId === id)!;
    expect(row(one.clientId)).toMatchObject({ proposal: "link", confidence: "strong", targetId: `existing-${tag}` });
    expect(row(two.clientId)).toMatchObject({ proposal: "create" });
    // Individuals get a Company too, named like their account (their Salesforce Account's name once linked).
    expect(row(solo.clientId)).toMatchObject({ proposal: "create" });
    expect(la.created).not.toContain(`Fresh Dance ${tag}`); // nothing written yet

    run = await confirmRun("la_companies", "staff:amy@anthonyinsuranceservices.com", { createContacts: false });
    run = await applyCompaniesBatch(run, { paceMs: 0 });
    expect((await getClient(one.clientId))!.ghlCompanyId).toBe(`existing-${tag}`);
    expect(la.contacts.get(`c1-${tag}`)!.businessId).toBe(`existing-${tag}`);
    expect(la.created).toContain(`Fresh Dance ${tag}`);
    // Two's contact is in another Company: left there, and said so.
    expect(la.contacts.get(`c2-${tag}`)!.businessId).toBe("someone-elses-company");
    expect((await listRows(run.runId)).rows.find((r) => r.sourceId === two.clientId)!.result).toMatch(/left in another Company/);
    const soloAccount = (await getClient(solo.clientId))!;
    expect(soloAccount.ghlCompanyId).toBeTruthy();
    expect(la.created).toContain(soloAccount.name);
  });
});
