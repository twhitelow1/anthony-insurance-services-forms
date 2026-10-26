import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { linksFor } from "@/lib/integrations/urls";
import { ensureClient, getContactByEmail } from "@/lib/clients/repo";
import { mockSalesforce } from "@/test/salesforce-mock";

// Lead Alchemist stand-in: two pages of contacts and one Company.
const la = vi.hoisted(() => ({
  pages: [] as { id: string; email?: string; phone?: string; firstName?: string; businessId?: string | null }[][],
  businesses: [{ id: "biz-dir", name: "Directory Studio" }] as { id: string; name: string; phone?: string }[],
}));
vi.mock("@/lib/ghl/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/ghl/client")>()),
  ghlConfig: async () => ({ token: "t", locationId: "LOC1" }),
  listBusinesses: async () => la.businesses,
  listContactsPage: async (after: unknown[] | null) => {
    const i = after ? Number(after[0]) : 0;
    return { contacts: la.pages[i] ?? [], total: la.pages.flat().length, next: i + 1 < la.pages.length ? [i + 1] : null };
  },
}));

const LINKS = linksFor({ salesforce: null, ghl: "https://app.leadalchemist.io", ghlLocationId: "LOC1", app: "https://forms.example.com" });
const ACTOR = "staff:amy@anthonyinsuranceservices.com";
const uniq = () => Math.random().toString(36).slice(2, 8);

describe("contacts directory", () => {
  it("imports both systems, matches people, filters by where they are, and adds the missing to the app", async () => {
    const { startImport, stepImport, listDirectory, addSelectedToApp, directoryBreakdown, directoryKeys } = await import("./directory");
    const tag = uniq();
    const db = await getDb();
    await db.delete(schema.directoryContacts);

    // In the app: Ann (also in Lead Alchemist by email) and Bo (app only).
    await ensureClient({ email: `ann.${tag}@gmail.com`, contactName: `Ann ${tag}`, businessName: `Ann Studio ${tag}` });
    await ensureClient({ email: `bo.${tag}@gmail.com`, contactName: `Bo ${tag}`, businessName: `Bo Gym ${tag}` });
    // Salesforce: Cy (only there) under an Account.
    const sf = mockSalesforce();
    const acct = await sf.api.create("Account", { Name: `Cy Corp ${tag}` });
    await sf.api.create("Contact", { AccountId: acct.id, Email: `cy.${tag}@gmail.com`, FirstName: "Cy", LastName: tag, Name: `Cy ${tag}` });
    // Lead Alchemist: Ann, and Di (only there) in a Company.
    la.pages = [[{ id: `la-ann-${tag}`, email: `ann.${tag}@gmail.com`, firstName: "Ann" }], [{ id: `la-di-${tag}`, email: `di.${tag}@gmail.com`, firstName: `Di ${tag}`, businessId: "biz-dir" }]];

    await startImport("lead_alchemist", ACTOR);
    expect((await stepImport("lead_alchemist", { sf: null }))!.phase).toBe("done");
    expect(sf.writes.length).toBe(2); // only the setup above: the import reads Salesforce
    await startImport("salesforce", ACTOR);
    const run = await stepImport("salesforce", { sf: sf.api });
    expect(run!.phase).toBe("done");

    const rows = async (filter: Parameters<typeof listDirectory>[0]["filter"]) => (await listDirectory({ q: tag, filter })).rows;
    const ann = (await rows("all")).find((r) => r.email === `ann.${tag}@gmail.com`)!;
    expect(ann).toMatchObject({ inApp: true, inLa: true, inSf: false, laId: `la-ann-${tag}` });
    expect((await rows("app_only")).map((r) => r.email)).toEqual([`bo.${tag}@gmail.com`]);
    expect((await rows("la_only")).map((r) => r.email)).toEqual([`di.${tag}@gmail.com`]);
    expect((await rows("la_only"))[0].laCompany).toBe("Directory Studio");
    const notApp = await rows("not_app");
    expect(notApp.map((r) => r.email).sort()).toEqual([`cy.${tag}@gmail.com`, `di.${tag}@gmail.com`]);
    expect((await rows("not_la")).map((r) => r.email).sort()).toEqual([`bo.${tag}@gmail.com`, `cy.${tag}@gmail.com`]);

    // Any combination: in the app and Lead Alchemist but not Salesforce → Ann.
    const both = await listDirectory({ q: tag, presence: { app: "yes", la: "yes", sf: "no" } });
    expect(both.rows.map((r) => r.email)).toEqual([`ann.${tag}@gmail.com`]);
    expect(both.total).toBe(1);
    expect((await listDirectory({ q: tag, presence: { app: "no" }, filter: "la_only" })).rows.map((r) => r.email)).toEqual([`di.${tag}@gmail.com`]);
    // "Select all matching" takes the same rows as the list, on every page.
    expect(await directoryKeys({ q: tag, presence: { app: "yes" } })).toEqual((await listDirectory({ q: tag, presence: { app: "yes" } })).rows.map((r) => r.key));
    expect(await directoryKeys({ q: tag, filter: "not_app" })).toHaveLength(2);
    const breakdown = await directoryBreakdown(tag);
    expect(breakdown.total).toBe(4);
    const combo = (app: boolean, sf: boolean, la: boolean) => breakdown.combos.find((c) => c.app === app && c.sf === sf && c.la === la)?.count ?? 0;
    expect([combo(true, false, true), combo(true, false, false), combo(false, true, false), combo(false, false, true)]).toEqual([1, 1, 1, 1]);

    // Add Cy (Salesforce: comes in with its Account) and Di (Lead Alchemist: a new account for its Company).
    const r = await addSelectedToApp(
      notApp.map((x) => x.key),
      ACTOR,
      { sf: sf.api, links: LINKS },
    );
    expect(r.notes).toEqual([]);
    expect(r.done).toBe(2);
    const cy = (await getContactByEmail(`cy.${tag}@gmail.com`))!;
    expect(cy.sfContactId).toBeTruthy();
    const di = (await getContactByEmail(`di.${tag}@gmail.com`))!;
    expect(di.ghlContactId).toBe(`la-di-${tag}`);
    const [diAccount] = await db.select().from(schema.clients).where(eq(schema.clients.id, di.clientId));
    expect(diAccount).toMatchObject({ name: "Directory Studio", ghlCompanyId: "biz-dir" });
    expect(await rows("not_app")).toHaveLength(0);
    expect(await listDirectory({ q: tag, filter: "all" }).then((x) => x.total)).toBe(4);
  });

  it("shows each person's account, Lead Alchemist Company (linked or suggested) and same-name look-alikes", async () => {
    const { startImport, stepImport, listDirectory } = await import("./directory");
    const tag = uniq();
    const db = await getDb();
    await db.delete(schema.directoryContacts);

    // AIS Connect: Eve at "Eve Fitness" (linked to Salesforce Account 001EVE), and Al.
    const eve = await ensureClient({ email: `eve.${tag}@gmail.com`, contactName: `Eve ${tag}`, businessName: `Eve Fitness ${tag} LLC` });
    await db.update(schema.clients).set({ sfAccountId: `001EVE${tag}` }).where(eq(schema.clients.id, eve));
    await ensureClient({ email: `al.${tag}@gmail.com`, contactName: `Al Smith${tag}`, businessName: `Al Gym ${tag}` });
    // Salesforce: Fay, another person at Eve's Account; Gus at an Account not in AIS Connect.
    const sf = mockSalesforce();
    await sf.api.create("Contact", { AccountId: `001EVE${tag}`, Email: `fay.${tag}@gmail.com`, FirstName: "Fay", LastName: tag, Name: `Fay ${tag}` });
    const gusCo = await sf.api.create("Account", { Name: `Gus Corp ${tag}` });
    await sf.api.create("Contact", { AccountId: gusCo.id, Email: `gus.${tag}@gmail.com`, FirstName: "Gus", LastName: tag, Name: `Gus ${tag}` });
    // Lead Alchemist: Companies named like Eve's account (punctuation and LLC aside) and Gus's; Al again under another email.
    la.businesses = [
      { id: `biz-eve-${tag}`, name: `Eve Fitness, ${tag}` },
      { id: `biz-gus-${tag}`, name: `Gus Corp ${tag}` },
    ];
    la.pages = [[{ id: `la-al-${tag}`, email: `al.${tag}@work.com`, firstName: `Al Smith${tag}` }]];
    await startImport("lead_alchemist", ACTOR);
    await stepImport("lead_alchemist", { sf: null });
    await startImport("salesforce", ACTOR);
    await stepImport("salesforce", { sf: sf.api });

    const rows = (await listDirectory({ q: tag })).rows;
    const by = (email: string) => rows.find((r) => r.email === email)!;
    // Fay isn't in AIS Connect, but her Account is: adding her won't make a new account.
    expect(by(`fay.${tag}@gmail.com`)).toMatchObject({ inApp: false, account: { id: eve }, suggestedCompany: { id: `biz-eve-${tag}`, how: "same name" } });
    expect(by(`eve.${tag}@gmail.com`).suggestedCompany).toMatchObject({ id: `biz-eve-${tag}` });
    // Gus's Account isn't here yet; the Company named like his Salesforce Account is suggested.
    expect(by(`gus.${tag}@gmail.com`)).toMatchObject({ account: null, suggestedCompany: { id: `biz-gus-${tag}` } });
    // Al is in Lead Alchemist under another email: the same full name is flagged both ways.
    expect(by(`al.${tag}@gmail.com`).sameName.la).toMatchObject({ id: `la-al-${tag}` });
    expect(by(`al.${tag}@work.com`).sameName.app).toMatchObject({ account: `Al Gym ${tag}` });

    // Filters: account in AIS Connect, Company state, possible duplicates.
    const emails = async (q: Parameters<typeof listDirectory>[0]) => (await listDirectory({ q: tag, ...q })).rows.map((r) => r.email).sort();
    expect(await emails({ presence: { app: "no", sf: "yes" }, account: "yes" })).toEqual([`fay.${tag}@gmail.com`]);
    expect(await emails({ presence: { app: "no", sf: "yes" }, account: "no" })).toEqual([`gus.${tag}@gmail.com`]);
    expect(await emails({ filter: "possible_dup" })).toEqual([`al.${tag}@gmail.com`, `al.${tag}@work.com`]);
    expect(await emails({ company: "suggested" })).toEqual([`eve.${tag}@gmail.com`, `fay.${tag}@gmail.com`, `gus.${tag}@gmail.com`]);

    // Once Eve's account is linked to the Company, it's "has one" for her and Fay.
    await db.update(schema.clients).set({ ghlCompanyId: `biz-eve-${tag}` }).where(eq(schema.clients.id, eve));
    expect(await emails({ company: "linked" })).toEqual([`eve.${tag}@gmail.com`, `fay.${tag}@gmail.com`]);
    expect(by(`gus.${tag}@gmail.com`).company).toBeNull();
    la.businesses = [{ id: "biz-dir", name: "Directory Studio" }];
  });
});

describe("Account Type filter on Contacts", () => {
  it("keeps only people whose account (AIS Connect or Salesforce) has that Type, including Salesforce contacts not in AIS Connect yet", async () => {
    const { listDirectory, directoryKeys } = await import("./directory");
    const { NO_ACCOUNT_TYPE } = await import("@/lib/clients/repo");
    const tag = uniq();
    const db = await getDb();
    const cust = await ensureClient({ email: `cu.${tag}@gmail.com`, contactName: `Cu Typed${tag}`, businessName: `Typed Cust ${tag}` });
    await ensureClient({ email: `pa.${tag}@gmail.com`, contactName: `Pa Typed${tag}`, businessName: `Typed Past ${tag}` });
    await db.update(schema.clients).set({ sfAccountType: "Customer" }).where(eq(schema.clients.id, cust));
    // A Salesforce contact (not in AIS Connect) under a Customer Salesforce Account.
    await db.insert(schema.directoryAccounts).values({ id: `001CT${tag}`, name: `SF Cust ${tag}`, nameKey: `sf cust ${tag}`, type: "Customer" });
    await db.insert(schema.directoryContacts).values({ source: "salesforce", externalId: `003CT${tag}`, name: `Sf Typed${tag}`, email: `sf.${tag}@gmail.com`, companyId: `001CT${tag}`, companyName: `SF Cust ${tag}` });

    const names = async (type?: string) => (await listDirectory({ q: `Typed${tag}`, type })).rows.map((r) => r.name).sort();
    expect(await names("Customer")).toEqual([`Cu Typed${tag}`, `Sf Typed${tag}`]);
    expect(await names(NO_ACCOUNT_TYPE)).toEqual([`Pa Typed${tag}`]);
    expect((await listDirectory({ q: `Typed${tag}`, type: "Customer", presence: { app: "no" } })).rows.map((r) => r.accountType)).toEqual(["Customer"]);
    expect((await directoryKeys({ q: `Typed${tag}`, type: "Customer" })).length).toBe(2); // "select all matching" uses it too
  });
});

describe("contacts search", () => {
  it("finds people by their business name as well as their own name, email or phone", async () => {
    const { listDirectory, directoryBreakdown } = await import("./directory");
    const tag = uniq();
    await ensureClient({ email: `s.${tag}@gmail.com`, contactName: `Sam Searcher`, businessName: `Kick Dojo ${tag}`, phone: "5552223344" });
    const emails = async (q: string) => (await listDirectory({ q })).rows.map((r) => r.email);
    expect(await emails(`kick dojo ${tag}`)).toEqual([`s.${tag}@gmail.com`]);
    expect(await emails(`s.${tag}@gmail`)).toEqual([`s.${tag}@gmail.com`]);
    expect((await directoryBreakdown(`Kick Dojo ${tag}`)).combos.reduce((n, c) => n + c.count, 0)).toBe(1);
  });
});
