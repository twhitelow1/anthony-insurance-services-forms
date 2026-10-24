import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { addContactToAccount, ensureClient, getContactByEmail } from "@/lib/clients/repo";
import { accountTypesInApp, listAccountMap, multiAccountContacts, NO_TYPE } from "./database";

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
