import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { linksFor } from "@/lib/integrations/urls";
import { assignApplicationClient, getClient, listClients, listClientEvents, resolveAccountAndContact } from "@/lib/clients/repo";
import { mockSalesforce } from "@/test/salesforce-mock";
import { getBulkSync, startBulkSync, stepBulkSync, stopBulkSync } from "./bulk-sync";
import { deactivateAccount, reactivateAccount, relinkSalesforceAccount, unsyncAccount } from "./manager";

const LINKS = linksFor({ salesforce: "https://org.lightning.force.com", ghl: null, ghlLocationId: null, app: "https://forms.example.com" });
const uniq = () => Math.random().toString(36).slice(2, 8);
const ACTOR = "staff:amy@anthonyinsuranceservices.com";

describe("deactivating an Account in this app", () => {
  it("needs it unsynced first, hides it, keeps its link, and reactivates with history", async () => {
    const tag = uniq();
    const { clientId } = await resolveAccountAndContact({ email: `d.${tag}@gmail.com`, contactName: "Dee Act", businessName: `Deact Gym ${tag}` });
    const db = await getDb();
    await db.update(schema.clients).set({ sfAccountId: `001DEACT${tag}AAA`, sfSyncPaused: false }).where(eq(schema.clients.id, clientId));

    await expect(deactivateAccount(clientId, ACTOR, "closed")).rejects.toThrow(/Unsync/);
    await unsyncAccount(clientId, ACTOR);
    await deactivateAccount(clientId, ACTOR, "Business closed");

    const after = (await getClient(clientId))!;
    expect(after.deactivatedAt).toBeTruthy();
    expect(after.sfAccountId).toBe(`001DEACT${tag}AAA`); // the link is remembered
    expect((await listClients({ q: tag })).rows.map((c) => c.id)).not.toContain(clientId);
    expect((await listClients({ q: tag, filter: "deactivated" })).rows.map((c) => c.id)).toContain(clientId);

    await reactivateAccount(clientId, ACTOR);
    expect((await getClient(clientId))!.deactivatedAt).toBeNull();
    const events = (await listClientEvents(clientId)).map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(["deactivated", "reactivated"]));
  });

  it("comes back on its own when a new application arrives", async () => {
    const tag = uniq();
    const details = { email: `n.${tag}@gmail.com`, contactName: "New App", businessName: `Return Gym ${tag}` };
    const { clientId } = await resolveAccountAndContact(details);
    await deactivateAccount(clientId, ACTOR);
    const db = await getDb();
    const [app] = await db
      .insert(schema.applications)
      .values({ reference: `AIS-${tag}`, formSlug: "gym", applicantEmail: details.email, applicantName: details.contactName, values: {}, searchText: tag })
      .returning();
    await assignApplicationClient(app.id, details);
    expect((await getClient(clientId))!.deactivatedAt).toBeNull();
  });
});

describe("linking to a different Salesforce Account", () => {
  it("keeps the old link in the activity and refuses one already used", async () => {
    const tag = uniq();
    const sf = mockSalesforce();
    const first = await sf.api.create("Account", { Name: `First ${tag}` });
    const second = await sf.api.create("Account", { Name: `Second ${tag}` });
    const { clientId } = await resolveAccountAndContact({ email: `r.${tag}@gmail.com`, businessName: `Relink ${tag}` });
    const other = await resolveAccountAndContact({ email: `o.${tag}@gmail.com`, businessName: `Other ${tag}` });
    const db = await getDb();
    await db.update(schema.clients).set({ sfAccountId: first.id }).where(eq(schema.clients.id, clientId));
    await db.update(schema.clients).set({ sfAccountId: second.id }).where(eq(schema.clients.id, other.clientId));

    await expect(relinkSalesforceAccount(clientId, second.id, sf.api, ACTOR)).rejects.toThrow(/already linked/);
    const third = await sf.api.create("Account", { Name: `Third ${tag}` });
    const writes = sf.writes.length;
    await relinkSalesforceAccount(clientId, `https://org.lightning.force.com/lightning/r/Account/${third.id}/view`, sf.api, ACTOR);
    expect(sf.writes.length).toBe(writes); // nothing written to Salesforce
    expect((await getClient(clientId))!.sfAccountId).toBe(third.id);
    const relinked = (await listClientEvents(clientId)).find((e) => e.type === "sf_relinked");
    expect(relinked?.data).toMatchObject({ from: first.id, to: third.id });
  });
});

describe("sync all matching Accounts", () => {
  it("brings every Account in across batches, skips deactivated ones, and writes nothing to Salesforce by default", async () => {
    const tag = uniq();
    const sf = mockSalesforce();
    const db = await getDb();
    // Clear any run left by another test.
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, "salesforce_bulk_sync"));
    const ids: string[] = [];
    for (let i = 0; i < 55; i++) ids.push((await sf.api.create("Account", { Name: `Bulk ${tag} ${i}` })).id);
    await sf.api.create("Contact", { AccountId: ids[0], Email: `bulk.${tag}@gmail.com`, FirstName: "Bea", LastName: "Ulk" });
    // One is already in the app and deactivated.
    const { clientId } = await resolveAccountAndContact({ email: `x.${tag}@gmail.com`, businessName: `Bulk ${tag} 3` });
    await db.update(schema.clients).set({ sfAccountId: ids[3], sfSyncPaused: true }).where(eq(schema.clients.id, clientId));
    await deactivateAccount(clientId, ACTOR);
    const writes = sf.writes.length;

    let run = await startBulkSync(sf.api, { q: "", type: "", writeLinks: false }, ACTOR);
    expect(run.total).toBe(55);
    await expect(startBulkSync(sf.api, { q: "", type: "", writeLinks: false }, ACTOR)).rejects.toThrow(/already in progress/);
    for (let i = 0; i < 5 && run.phase === "running"; i++) run = (await stepBulkSync({ sf: sf.api, links: LINKS }))!;

    expect(run).toMatchObject({ phase: "done", done: 55, skipped: 1, failed: 0 });
    expect(run.created + run.linked).toBe(54);
    expect(sf.writes.length).toBe(writes);
    expect((await getClient(clientId))!.deactivatedAt).toBeTruthy();
    const [synced] = await db.select().from(schema.clients).where(eq(schema.clients.sfAccountId, ids[0]));
    expect(synced).toMatchObject({ sfSyncPaused: false });
  });

  it("pauses when Salesforce API use passes 80%, and can be stopped", async () => {
    const sf = mockSalesforce({ usage: () => ({ used: 900, max: 1000 }) });
    const db = await getDb();
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, "salesforce_bulk_sync"));
    for (let i = 0; i < 60; i++) await sf.api.create("Account", { Name: `Paused ${uniq()} ${i}` });
    await startBulkSync(sf.api, { q: "", type: "", writeLinks: false }, ACTOR);
    const run = (await stepBulkSync({ sf: sf.api, links: LINKS }))!;
    expect(run.phase).toBe("paused");
    expect(run.done).toBe(50);
    expect(run.pausedReason).toMatch(/API use/);
    await stopBulkSync(ACTOR);
    expect((await getBulkSync())!.phase).toBe("stopped");
  });
});
