import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { addContactToAccount, ensureClient, getContactByEmail } from "@/lib/clients/repo";
import { accountMapIds, accountTypesInApp, contactMapIds, listAccountMap, listContactMap, multiAccountContacts, NO_TYPE } from "./database";

const uniq = () => Math.random().toString(36).slice(2, 8);

describe("mapping database", () => {
  it("filters accounts by Salesforce Account Type and by what's mapped", async () => {
    const tag = uniq();
    const current = await ensureClient({ email: `c.${tag}@gmail.com`, contactName: `Cur ${tag}`, businessName: `Current Studio ${tag}`, phone: "5551110000" });
    const past = await ensureClient({ email: `p.${tag}@gmail.com`, contactName: `Pas ${tag}`, businessName: `Past Studio ${tag}`, phone: "5552220000" });
    const db = await getDb();
    await db.update(schema.clients).set({ sfAccountType: "Customer", sfAccountId: `001${tag}A` }).where(eq(schema.clients.id, current));
    await db.update(schema.clients).set({ sfAccountType: "Former Customer" }).where(eq(schema.clients.id, past));

    expect(await accountTypesInApp()).toEqual(expect.arrayContaining(["Customer", "Former Customer"]));
    const customers = await listAccountMap({ q: tag, type: "Customer" });
    expect(customers.rows.map((r) => r.id)).toEqual([current]);
    expect((await listAccountMap({ q: tag, type: "Former Customer" })).rows.map((r) => r.id)).toEqual([past]);
    expect((await listAccountMap({ q: tag, type: NO_TYPE })).rows).toHaveLength(0);
    // "In Salesforce, not in Lead Alchemist" + Customer.
    expect((await listAccountMap({ q: tag, filter: "sf_not_la", type: "Customer" })).rows.map((r) => r.id)).toEqual([current]);
    // "Select all matching" takes the same rows as the list, on every page.
    expect(await accountMapIds({ q: tag, filter: "sf_not_la", type: "Customer" })).toEqual([current]);
    expect((await accountMapIds({ q: tag })).sort()).toEqual([current, past].sort());
    expect(await contactMapIds({ q: tag, filter: "no_la" })).toEqual((await listContactMap({ q: tag, filter: "no_la" })).rows.map((r) => r.contact.id));
  });

  it("lists people tied to more than one account", async () => {
    const tag = uniq();
    const home = await ensureClient({ email: `m.${tag}@gmail.com`, contactName: `Mia ${tag}`, businessName: `Home Studio ${tag}` });
    const other = await ensureClient({ email: `o.${tag}@gmail.com`, contactName: `Oli ${tag}`, businessName: `Other Gym ${tag}` });
    const mia = (await getContactByEmail(`m.${tag}@gmail.com`))!;
    await addContactToAccount(other, mia.id, "staff:amy@example.com");
    const found = (await multiAccountContacts()).find((m) => m.contact.id === mia.id);
    expect(found?.accounts.map((a) => [a.id, a.home])).toEqual(
      expect.arrayContaining([
        [home, true],
        [other, false],
      ]),
    );
  });
});

describe("creating an account in Salesforce brings its people along", () => {
  it("creates the Account, creates the applicant's Contact under it, and puts an Account-less Contact under it", async () => {
    const { createAccountsInSalesforce } = await import("./database");
    const { linksFor } = await import("@/lib/integrations/urls");
    const tag = uniq();
    const clientId = await ensureClient({ email: `a.${tag}@gmail.com`, contactName: `Ana ${tag}`, businessName: `Ana Studio ${tag}`, phone: "5553334444" });
    const { ensureContact } = await import("@/lib/clients/repo");
    await ensureContact({ clientId, email: `b.${tag}@gmail.com`, firstName: "Ben", lastName: tag });

    const records: Record<string, Record<string, unknown>[]> = { Account: [], Contact: [{ Id: "003ORPHAN", Email: `b.${tag}@gmail.com`, AccountId: null }] };
    const updates: [string, string, Record<string, unknown>][] = [];
    const sf = {
      describe: async (o: string) => ({
        name: o,
        fields: ["Name", "Phone", "Website", "BillingStreet", "BillingCity", "BillingState", "BillingPostalCode", "AccountId", "FirstName", "LastName", "Email", "Title"].map((name) => ({ name, type: "string", createable: true, updateable: true })),
      }),
      query: async (soql: string) => {
        if (soql.includes("FROM Account WHERE Name")) return [];
        const email = soql.match(/Email = '([^']+)'/)?.[1];
        if (soql.includes("FROM Contact") && email) return records.Contact.filter((c) => c.Email === email);
        return [];
      },
      create: async (o: string, data: Record<string, unknown>) => {
        const id = `${o === "Account" ? "001" : "003"}NEW${records[o].length}`;
        records[o].push({ Id: id, ...data });
        return { id };
      },
      update: async (o: string, id: string, data: Record<string, unknown>) => {
        updates.push([o, id, data]);
      },
    } as unknown as import("@/lib/salesforce/api").SalesforceApi;

    const r = await createAccountsInSalesforce([clientId], "staff:amy@example.com", { sf, links: linksFor({ salesforce: null, ghl: null, ghlLocationId: null, app: null }) });
    expect(r.done).toBe(1);
    const accountId = records.Account[0].Id;
    expect(records.Account[0]).toMatchObject({ Name: `Ana Studio ${tag}` });
    expect(records.Account[0].Type).toBeUndefined();
    // Ana had no Salesforce Contact: created under the new Account.
    expect(records.Contact.find((c) => c.Email === `a.${tag}@gmail.com`)).toMatchObject({ AccountId: accountId });
    // Ben's Contact had no Account: put under it (only AccountId changes).
    expect(updates).toContainEqual(["Contact", "003ORPHAN", { AccountId: accountId }]);
    expect(r.notes.join(" ")).toMatch(/1 contact created, 1 put under the Account/);
  });
});
