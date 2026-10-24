import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getClient, resolveAccountAndContact } from "./repo";

const uniq = () => Math.random().toString(36).slice(2, 8);

describe("matching an application to Salesforce and existing accounts", () => {
  it("joins the Salesforce Account of the person's Salesforce Contact (renewal / new coverage)", async () => {
    const tag = uniq();
    const db = await getDb();
    await db.insert(schema.directoryContacts).values({
      source: "salesforce",
      externalId: `003REN${tag}`,
      name: `Rita ${tag}`,
      email: `rita.${tag}@gmail.com`,
      companyId: `001REN${tag}AAA`,
      companyName: `Renewal Gym ${tag}`,
    });
    // The Salesforce Account isn't in AIS Connect yet: it's created and linked to Salesforce.
    const first = await resolveAccountAndContact({ email: `rita.${tag}@gmail.com`, contactName: `Rita ${tag}`, businessName: `Renewal Gym ${tag} LLC` });
    expect(first.match).toBe("salesforce");
    expect(await getClient(first.clientId)).toMatchObject({ sfAccountId: `001REN${tag}AAA`, name: `Renewal Gym ${tag}` });

    // A coworker on a new application with the same Salesforce Account joins it too.
    await db.insert(schema.directoryContacts).values({ source: "salesforce", externalId: `003CO${tag}`, name: "Co", email: `co.${tag}@gmail.com`, companyId: `001REN${tag}AAA`, companyName: `Renewal Gym ${tag}` });
    const second = await resolveAccountAndContact({ email: `co.${tag}@gmail.com`, contactName: "Co Worker", businessName: `Renewal Gym ${tag}` });
    expect(second).toMatchObject({ clientId: first.clientId, match: "salesforce" });
  });

  it("makes a new account and a notification when something close exists", async () => {
    const tag = uniq();
    const existing = await resolveAccountAndContact({ email: `a.${tag}@gmail.com`, contactName: "Ann", businessName: `Bright Star Dance ${tag}`, phone: "5554443333" });
    const app = await resolveAccountAndContact({ email: `b.${tag}@gmail.com`, contactName: "Bea", businessName: `Bright Star Dance Academy ${tag}`, phone: "5554443333" });
    expect(app.clientId).not.toBe(existing.clientId);
    const db = await getDb();
    const [n] = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.kind, "possible_duplicate"), eq(schema.notifications.clientId, app.clientId)));
    expect(n.title).toContain(`Bright Star Dance Academy ${tag}`);
    expect(n.detail).toContain(`Bright Star Dance ${tag}`);
    expect(n.detail).toMatch(/same phone/);
  });
});
