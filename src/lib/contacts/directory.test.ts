import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { linksFor } from "@/lib/integrations/urls";
import { ensureClient, getContactByEmail } from "@/lib/clients/repo";
import { mockSalesforce } from "@/test/salesforce-mock";

// Lead Alchemist stand-in: two pages of contacts and one Company.
const la = vi.hoisted(() => ({ pages: [] as { id: string; email?: string; phone?: string; firstName?: string; businessId?: string | null }[][] }));
vi.mock("@/lib/ghl/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/ghl/client")>()),
  ghlConfig: async () => ({ token: "t", locationId: "LOC1" }),
  listBusinesses: async () => [{ id: "biz-dir", name: "Directory Studio" }],
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
    const { startImport, stepImport, listDirectory, addSelectedToApp, directoryBreakdown } = await import("./directory");
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
});
