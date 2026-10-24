import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { linksFor } from "@/lib/integrations/urls";
import { ensureClient } from "@/lib/clients/repo";
import { mockSalesforce } from "@/test/salesforce-mock";

// Lead Alchemist stand-in: its Companies.
const la = vi.hoisted(() => ({ businesses: [] as { id: string; name: string; phone?: string }[] }));
vi.mock("@/lib/ghl/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/ghl/client")>()),
  ghlConfig: async () => ({ token: "t", locationId: "LOC1" }),
  listBusinesses: async () => la.businesses,
}));

const LINKS = linksFor({ salesforce: null, ghl: "https://app.leadalchemist.io", ghlLocationId: "LOC1", app: "https://forms.example.com" });
const ACTOR = "staff:amy@anthonyinsuranceservices.com";
const uniq = () => Math.random().toString(36).slice(2, 8);

describe("accounts across all three", () => {
  it("lists accounts from every system with counts and suggested matches, and links instead of duplicating", async () => {
    const { startAccountImport, stepAccountImport, listAccountDirectory, accountBreakdown, addAccountsToApp, linkSuggestedMatches } = await import("./directory");
    const tag = uniq();
    const db = await getDb();
    await db.delete(schema.directoryAccounts);
    await db.delete(schema.directoryCompanies);

    // AIS Connect: Alpha (in nothing else yet) and Gamma.
    const alpha = await ensureClient({ email: `a.${tag}@gmail.com`, contactName: `Al ${tag}`, businessName: `Alpha ${tag}` });
    const gamma = await ensureClient({ email: `g.${tag}@gmail.com`, contactName: `Gil ${tag}`, businessName: `Gamma ${tag} LLC` });
    // Salesforce: an Account named like Alpha, and Beta (only there) with a Contact.
    const sf = mockSalesforce();
    const sfAlpha = await sf.api.create("Account", { Name: `Alpha ${tag}` });
    const sfBeta = await sf.api.create("Account", { Name: `Beta ${tag}` });
    await sf.api.create("Contact", { AccountId: sfBeta.id, Email: `b.${tag}@gmail.com`, FirstName: "Bo", LastName: tag, Name: `Bo ${tag}` });
    // Lead Alchemist: Beta (same name as the Salesforce Account) and Gamma (same name as the account, punctuation and LLC aside).
    la.businesses = [
      { id: `biz-beta-${tag}`, name: `Beta ${tag}` },
      { id: `biz-gamma-${tag}`, name: `Gamma, ${tag}` },
    ];

    await startAccountImport("salesforce", ACTOR);
    expect((await stepAccountImport("salesforce", { sf: sf.api }))!.phase).toBe("done");
    await startAccountImport("lead_alchemist", ACTOR);
    expect((await stepAccountImport("lead_alchemist", { sf: null }))!.phase).toBe("done");
    expect(sf.writes).toHaveLength(3); // only the setup: reading Salesforce writes nothing

    const rows = async (q = {}) => (await listAccountDirectory({ q: tag, ...q })).rows;
    const by = async (name: string) => (await rows()).find((r) => r.name === name)!;
    expect((await rows()).map((r) => r.key[0]).sort()).toEqual(["a", "a", "l", "l", "s", "s"]);
    expect(await by(`Alpha ${tag}`)).toMatchObject({ inApp: true, inSf: false, suggested: { sf: { id: sfAlpha.id, how: "same name" }, la: null } });
    expect((await by(`Gamma ${tag} LLC`)).suggested.la).toMatchObject({ id: `biz-gamma-${tag}` });
    const beta = (await rows()).find((r) => r.key === `s:${sfBeta.id}`)!;
    expect(beta).toMatchObject({ inApp: false, inSf: true, suggested: { app: null, la: { id: `biz-beta-${tag}` } } });
    // The Lead Alchemist Company named like Gamma suggests the AIS Connect account.
    expect((await rows()).find((r) => r.key === `l:biz-gamma-${tag}`)!.suggested.app).toMatchObject({ id: gamma });

    // Filters and the breakdown.
    expect((await rows({ presence: { app: "no", sf: "yes" } })).map((r) => r.key).sort()).toEqual([`s:${sfAlpha.id}`, `s:${sfBeta.id}`].sort());
    expect((await rows({ presence: { app: "no" }, match: "none" })).map((r) => r.key)).toEqual([]);
    expect((await accountBreakdown(tag)).total).toBe(6);

    // Link only: Alpha ↔ its Salesforce Account; Gamma ↔ its Company. Nothing is created anywhere.
    const linked = await linkSuggestedMatches([`a:${alpha}`, `l:biz-gamma-${tag}`], ACTOR, { sf: sf.api, links: LINKS });
    expect(linked.done).toBe(2);
    expect(sf.writes).toHaveLength(3);
    const [alphaRow] = await db.select().from(schema.clients).where(eq(schema.clients.id, alpha));
    expect(alphaRow.sfAccountId).toBe(sfAlpha.id);
    const [gammaRow] = await db.select().from(schema.clients).where(eq(schema.clients.id, gamma));
    expect(gammaRow.ghlCompanyId).toBe(`biz-gamma-${tag}`);

    // Add Beta: it comes in from Salesforce with its Contact and is linked to the Company with its name.
    const added = await addAccountsToApp([`s:${sfBeta.id}`], ACTOR, { sf: sf.api, links: LINKS }, { useSuggested: true });
    expect(added.notes).toEqual([]);
    expect(added.done).toBe(1);
    const [betaRow] = await db.select().from(schema.clients).where(eq(schema.clients.sfAccountId, sfBeta.id));
    expect(betaRow.ghlCompanyId).toBe(`biz-beta-${tag}`);
    // Now everything is one row per business, linked across.
    expect((await rows()).map((r) => r.key[0]).sort()).toEqual(["a", "a", "a"]);
    expect((await by(`Beta ${tag}`)).counts.appContacts).toBe(1);
    la.businesses = [];
  });
});

describe("Account Type filter", () => {
  it("filters by the Salesforce Account Type (app accounts and unlinked Salesforce Accounts), combined with the other filters", async () => {
    const { listAccountDirectory, accountDirectoryKeys, accountTypesAcross, NO_ACCOUNT_TYPE } = await import("./directory");
    const tag = uniq();
    const db = await getDb();
    const cust = await ensureClient({ email: `c.${tag}@gmail.com`, contactName: `Cu ${tag}`, businessName: `Typed Customer ${tag}` });
    const past = await ensureClient({ email: `p.${tag}@gmail.com`, contactName: `Pa ${tag}`, businessName: `Typed Past ${tag}` });
    await ensureClient({ email: `n.${tag}@gmail.com`, contactName: `No ${tag}`, businessName: `Typed None ${tag}` });
    await db.update(schema.clients).set({ sfAccountType: "Customer" }).where(eq(schema.clients.id, cust));
    await db.update(schema.clients).set({ sfAccountType: "Past Client" }).where(eq(schema.clients.id, past));
    await db.insert(schema.directoryAccounts).values({ id: `001TY${tag}`, name: `Typed SF ${tag}`, nameKey: `typed sf ${tag}`, type: "Customer" });

    const names = async (q: Parameters<typeof listAccountDirectory>[0]) => (await listAccountDirectory({ q: `Typed`, ...q })).rows.filter((r) => r.name.includes(tag)).map((r) => r.name).sort();
    expect(await names({ type: "Customer" })).toEqual([`Typed Customer ${tag}`, `Typed SF ${tag}`]);
    expect(await names({ type: "Customer", presence: { app: "yes" } })).toEqual([`Typed Customer ${tag}`]);
    expect(await names({ type: "Past Client", laMissing: true })).toEqual([`Typed Past ${tag}`]);
    expect(await names({ type: NO_ACCOUNT_TYPE })).toEqual([`Typed None ${tag}`]);
    expect((await accountDirectoryKeys({ q: `Typed Customer ${tag}`, type: "Customer" })).length).toBe(1); // "select all matching" uses the same filter
    expect(await accountTypesAcross()).toEqual(expect.arrayContaining(["Customer", "Past Client"]));
  });
});
