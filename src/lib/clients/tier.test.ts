import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ensureClient, ensureContact, getClient, getContactByEmail, listClientEvents, listClients, setPrimaryContact, splitContact } from "./repo";

const uniq = () => Math.random().toString(36).slice(2, 8);
const ACTOR = "staff:amy@anthonyinsuranceservices.com";

describe("client tier: one primary contact per account", () => {
  it("makes the applicant primary, the others secondary, and 'Make primary' swaps them with a log entry", async () => {
    const tag = uniq();
    const clientId = await ensureClient({ email: `p.${tag}@gmail.com`, contactName: `Pat ${tag}`, businessName: `Tier Gym ${tag}` });
    const pat = (await getContactByEmail(`p.${tag}@gmail.com`))!;
    expect((await getClient(clientId))!).toMatchObject({ primaryContactId: pat.id, primaryReview: false });

    const sam = await ensureContact({ clientId, name: `Sam ${tag}`, email: `s.${tag}@gmail.com` });
    expect((await getClient(clientId))!.primaryContactId).toBe(pat.id); // a new contact is secondary

    await setPrimaryContact(clientId, sam.id, ACTOR);
    expect((await getClient(clientId))!).toMatchObject({ primaryContactId: sam.id, primaryEmail: `s.${tag}@gmail.com` });
    const events = await listClientEvents(clientId);
    expect(events.find((e) => e.type === "primary_changed" && e.actor === ACTOR)?.message).toBe(`Sam ${tag} is now the primary contact; Pat ${tag} is now secondary (by amy@anthonyinsuranceservices.com)`);

    // Splitting the primary off: the account picks a new one.
    await splitContact(clientId, sam.id, ACTOR);
    expect((await getClient(clientId))!.primaryContactId).toBe(pat.id);
  });

  it("flags an automatic pick of several for review, and the filter lists it until staff choose", async () => {
    const tag = uniq();
    const clientId = await ensureClient({ email: `x.${tag}@gmail.com`, contactName: `Xi ${tag}`, businessName: `Many Gym ${tag}` });
    const yo = await ensureContact({ clientId, name: `Yo ${tag}`, email: `y.${tag}@gmail.com` });
    // No primary and no applicant to go by (e.g. imported from Salesforce): the first contact, flagged.
    const db = await getDb();
    await db.update(schema.clients).set({ primaryContactId: null, primaryEmail: null }).where(eq(schema.clients.id, clientId));
    await db.update(schema.applications).set({ contactId: null }).where(eq(schema.applications.clientId, clientId));
    const { ensurePrimaryContact } = await import("./repo");
    const picked = await ensurePrimaryContact(clientId);
    expect(picked).toBe((await getContactByEmail(`x.${tag}@gmail.com`))!.id);
    expect((await getClient(clientId))!.primaryReview).toBe(true);
    expect((await listClients({ q: tag, filter: "no_primary" })).rows.map((r) => r.id)).toEqual([clientId]);

    await setPrimaryContact(clientId, yo.id, ACTOR);
    expect((await getClient(clientId))!.primaryReview).toBe(false);
    expect((await listClients({ q: tag, filter: "no_primary" })).rows).toEqual([]);
  });

  it("refuses a contact that isn't on the account", async () => {
    const tag = uniq();
    const a = await ensureClient({ email: `a.${tag}@gmail.com`, contactName: `Al ${tag}`, businessName: `A Gym ${tag}` });
    await ensureClient({ email: `b.${tag}@gmail.com`, contactName: `Bo ${tag}`, businessName: `B Gym ${tag}` });
    const bo = (await getContactByEmail(`b.${tag}@gmail.com`))!;
    await expect(setPrimaryContact(a, bo.id, ACTOR)).rejects.toThrow(/isn't on this account/);
  });
});

describe("Account Type filter on Accounts", () => {
  it("lists only accounts with that Salesforce Account Type, or none", async () => {
    const { NO_ACCOUNT_TYPE } = await import("./repo");
    const tag = uniq();
    const db = await getDb();
    const cust = await ensureClient({ email: `c.${tag}@gmail.com`, contactName: `Cu ${tag}`, businessName: `Type Gym A ${tag}` });
    const none = await ensureClient({ email: `n.${tag}@gmail.com`, contactName: `No ${tag}`, businessName: `Type Gym B ${tag}` });
    await db.update(schema.clients).set({ sfAccountType: "Customer" }).where(eq(schema.clients.id, cust));
    expect((await listClients({ q: tag, type: "Customer" })).rows.map((r) => [r.id, r.sfAccountType])).toEqual([[cust, "Customer"]]);
    expect((await listClients({ q: tag, type: NO_ACCOUNT_TYPE })).rows.map((r) => r.id)).toEqual([none]);
    expect((await listClients({ q: tag })).rows).toHaveLength(2);
  });
});
