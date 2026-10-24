import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { linksFor } from "@/lib/integrations/urls";
import { ensureClient, listAccountContacts } from "@/lib/clients/repo";
import { mockSalesforce } from "@/test/salesforce-mock";

// Lead Alchemist stand-in: Companies, and a record of contacts moved between them.
const la = vi.hoisted(() => ({ moved: [] as { ids: string[]; businessId: string }[], updated: [] as { id: string; input: unknown }[] }));
vi.mock("@/lib/ghl/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/ghl/client")>()),
  ghlConfig: async () => ({ token: "t", locationId: "LOC1" }),
  getBusiness: async (id: string) => ({ id, name: id.includes("one") ? "Merge Gym One" : "Merge Gym, LLC", phone: "555-0100", email: "info@mergegym.com" }),
  addContactsToBusiness: async (ids: string[], businessId: string) => {
    la.moved.push({ ids, businessId });
  },
  updateBusiness: async (id: string, input: unknown) => {
    la.updated.push({ id, input });
  },
}));

const LINKS = linksFor({ salesforce: null, ghl: "https://app.leadalchemist.io", ghlLocationId: "LOC1", app: "https://forms.example.com" });
const ACTOR = "staff:amy@anthonyinsuranceservices.com";
const uniq = () => Math.random().toString(36).slice(2, 8);

describe("compare and merge", () => {
  it("merges two accounts, two Salesforce Accounts and two Companies, keeping what staff pick", async () => {
    const { loadMergeRecords, mergeAccounts } = await import("./merge");
    const tag = uniq();
    const db = await getDb();
    const sf = mockSalesforce();
    const sfA = await sf.api.create("Account", { Name: `Merge Gym ${tag}`, Phone: "555-0100" });
    const sfB = await sf.api.create("Account", { Name: `Merge Gym ${tag} LLC`, BillingCity: "Austin" });
    const writesBefore = sf.writes.length;

    // Two AIS Connect accounts: X (linked to Salesforce A and Company one) and Y.
    const x = await ensureClient({ email: `x.${tag}@gmail.com`, contactName: `Xi ${tag}`, businessName: `Merge Gym ${tag}` });
    const y = await ensureClient({ email: `y.${tag}@gmail.com`, contactName: `Yo ${tag}`, businessName: `Merge Gym ${tag} Inc` });
    await db.update(schema.clients).set({ sfAccountId: sfA.id, ghlCompanyId: `biz-one-${tag}` }).where(eq(schema.clients.id, x));
    // Company two has a contact in Lead Alchemist.
    await db.insert(schema.directoryContacts).values({ source: "lead_alchemist", externalId: `la-p-${tag}`, name: "Pat", companyId: `biz-two-${tag}`, companyName: "Two" });

    const keys = [`a:${x}`, `a:${y}`, `s:${sfB.id}`, `l:biz-two-${tag}`];
    const records = await loadMergeRecords(keys, { sf: sf.api, laConnected: true });
    // The selected rows plus what X is linked to: 2 accounts, 2 Salesforce Accounts, 2 Companies.
    expect(records.map((r) => r.system).sort()).toEqual(["app", "app", "la", "la", "sf", "sf"]);
    expect(records.find((r) => r.id === sfB.id)!.values.city).toBe("Austin");

    const r = await mergeAccounts(
      { keys, keepApp: y, keepSf: sfB.id, keepLa: `biz-one-${tag}`, values: { name: `Merge Gym ${tag}`, phone: "555-0100", city: "Austin" }, writeSf: false, writeLa: false },
      ACTOR,
      { sf: sf.api, links: LINKS, laConnected: true },
    );
    expect(r.clientId).toBe(y);
    const [kept] = await db.select().from(schema.clients).where(eq(schema.clients.id, y));
    expect(kept).toMatchObject({ name: `Merge Gym ${tag}`, sfAccountId: sfB.id, ghlCompanyId: `biz-one-${tag}`, address: expect.objectContaining({ city: "Austin" }) });
    expect(kept.phones[0]).toBe("555-0100");
    const [gone] = await db.select().from(schema.clients).where(eq(schema.clients.id, x));
    expect(gone.mergedInto).toBe(y);
    expect((await listAccountContacts(y)).length).toBe(2);
    // Salesforce A is hidden here, not touched in Salesforce; Company two's contact moved to Company one, and two is hidden.
    expect(sf.writes.length).toBe(writesBefore);
    const [hiddenSf] = await db.select().from(schema.salesforceHidden).where(eq(schema.salesforceHidden.sfId, sfA.id));
    expect(hiddenSf).toBeTruthy();
    expect(la.moved).toEqual([{ ids: [`la-p-${tag}`], businessId: `biz-one-${tag}` }]);
    const [hiddenLa] = await db.select().from(schema.leadAlchemistHidden).where(eq(schema.leadAlchemistHidden.id, `biz-two-${tag}`));
    expect(hiddenLa).toMatchObject({ keptId: `biz-one-${tag}` });
    expect(r.notes.join(" ")).toMatch(/still in Salesforce/);
  });

  it("can write the chosen details to the kept Salesforce Account and Company, and refuses a record linked elsewhere", async () => {
    const { mergeAccounts, markNotDuplicates } = await import("./merge");
    const tag = uniq();
    const db = await getDb();
    const sf = mockSalesforce();
    const acct = await sf.api.create("Account", { Name: `Write Co ${tag}` });
    const a = await ensureClient({ email: `a.${tag}@gmail.com`, contactName: `Al ${tag}`, businessName: `Write Co ${tag}` });
    la.updated = [];
    await mergeAccounts(
      { keys: [`a:${a}`, `s:${acct.id}`, `l:biz-w-${tag}`], keepApp: a, keepSf: acct.id, keepLa: `biz-w-${tag}`, values: { name: `Write Co ${tag}`, phone: "555-0199" }, writeSf: true, writeLa: true },
      ACTOR,
      { sf: sf.api, links: LINKS, laConnected: true },
    );
    expect(sf.writes.at(-1)).toMatchObject({ op: "update", object: "Account", id: acct.id, data: expect.objectContaining({ Phone: "555-0199" }) });
    expect(la.updated).toEqual([{ id: `biz-w-${tag}`, input: expect.objectContaining({ phone: "555-0199" }) }]);

    // A Salesforce Account linked to an account outside the merge can't be the one kept.
    const other = await ensureClient({ email: `o.${tag}@gmail.com`, contactName: `Oz ${tag}`, businessName: `Other ${tag}` });
    const b = await ensureClient({ email: `b.${tag}@gmail.com`, contactName: `Bo ${tag}`, businessName: `Bee ${tag}` });
    await db.update(schema.clients).set({ sfAccountId: acct.id }).where(eq(schema.clients.id, other));
    await expect(
      mergeAccounts({ keys: [`a:${b}`, `s:${acct.id}`], keepApp: b, keepSf: acct.id, keepLa: null, values: {}, writeSf: false, writeLa: false }, ACTOR, { sf: sf.api, links: LINKS, laConnected: true }),
    ).rejects.toThrow(/Include that account/);

    // "Not the same business" records each pair once.
    expect(await markNotDuplicates([`a:${b}`, `s:${acct.id}`, `a:${b}`], ACTOR)).toBe(2);
    const pairs = await db.select().from(schema.notDuplicates).where(eq(schema.notDuplicates.pair, [`a:${b}`, `s:${acct.id}`].sort().join("|")));
    expect(pairs).toHaveLength(1);
  });
});
