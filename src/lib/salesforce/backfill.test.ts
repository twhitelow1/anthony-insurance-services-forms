import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ensureClient, getClient, getClientIdForEmail } from "@/lib/clients/repo";
import { linksFor } from "@/lib/integrations/urls";
import { mockSalesforce } from "@/test/salesforce-mock";
import { backfillReportCsv, getBackfillState, runBackfillBatch, startBackfill } from "./backfill";

const LINKS = linksFor({ salesforce: "https://org.lightning.force.com", ghl: "https://app.la.example", ghlLocationId: "LOC", app: "https://forms.example.com" });
const uniq = () => Math.random().toString(36).slice(2, 8);

async function seed(sf: ReturnType<typeof mockSalesforce>) {
  const tag = uniq();
  const known = `known.${tag}@example.com`;
  const fresh = `fresh.${tag}@example.com`;
  const twoA = `two-a.${tag}@example.com`;
  const twoB = `two-b.${tag}@example.com`;
  const knownClient = await ensureClient({ email: known, contactName: "Known Person" });
  await ensureClient({ email: twoA });
  await ensureClient({ email: twoB });
  const a1 = await sf.api.create("Account", { Name: "Known Studio", Phone: "555-0100" });
  await sf.api.create("Contact", { AccountId: a1.id, Email: known.toUpperCase(), LastName: "Person" });
  const a2 = await sf.api.create("Account", { Name: "Fresh Gym", Phone: "555-0200" });
  await sf.api.create("Contact", { AccountId: a2.id, Email: fresh, FirstName: "Fresh", LastName: "Owner" });
  const a3 = await sf.api.create("Account", { Name: "No Contacts LLC" });
  const a4 = await sf.api.create("Account", { Name: "Two Clients Inc" });
  await sf.api.create("Contact", { AccountId: a4.id, Email: twoA, LastName: "A" });
  await sf.api.create("Contact", { AccountId: a4.id, Email: twoB, LastName: "B" });
  sf.writes.length = 0; // seeding isn't part of the backfill
  return { known, fresh, knownClient, a1: a1.id, a2: a2.id, a3: a3.id, a4: a4.id };
}

const deps = (sf: ReturnType<typeof mockSalesforce>) => ({ sf: sf.api, links: LINKS, paceMs: 0, timeBudgetMs: 30_000 });

describe("Salesforce backfill", () => {
  it("dry run reports matched, new, ambiguous and skipped, and writes nothing", async () => {
    const sf = mockSalesforce();
    const s = await seed(sf);
    await startBackfill("dry_run", "staff:test");
    const state = await runBackfillBatch(deps(sf), "staff:test");
    expect(state).toMatchObject({ done: true, counts: { matched: 1, new: 1, ambiguous: 1, skipped: 1, error: 0 } });
    expect(sf.writes).toHaveLength(0);
    expect(await getClientIdForEmail(s.fresh)).toBeNull();
    expect((await getClient(s.knownClient))!.sfAccountId).toBeNull();

    const csv = await backfillReportCsv(state.runId, LINKS);
    expect(csv.split("\r\n")[0]).toBe("Outcome,Salesforce Account ID,Account name,Contact emails,Client page,Note,Mode");
    expect(csv).toContain(`matched,${s.a1},Known Studio`);
    expect(csv).toContain(`ambiguous,${s.a4}`);
  });

  it("apply links clients, creates new ones, writes only the link fields, and is safe to re-run", async () => {
    const sf = mockSalesforce();
    const s = await seed(sf);
    await startBackfill("apply", "staff:test");
    await runBackfillBatch(deps(sf), "staff:test");

    expect((await getClient(s.knownClient))!).toMatchObject({ sfAccountId: s.a1, sfStatus: "linked" });
    const freshId = (await getClientIdForEmail(s.fresh))!;
    expect((await getClient(freshId))!).toMatchObject({ name: "Fresh Gym", sfAccountId: s.a2 });
    // Only the new link fields were written, never other data, and nothing for ambiguous or skipped Accounts.
    for (const w of sf.writes) {
      expect(w.op).toBe("update");
      expect(Object.keys(w.data).every((k) => ["Applications_Link__c", "LA_Contact_Link__c"].includes(k))).toBe(true);
    }
    expect(sf.writes.map((w) => w.id)).not.toContain(s.a3);
    expect(sf.writes.map((w) => w.id)).not.toContain(s.a4);
    expect(sf.records.Account.find((a) => a.Id === s.a1)!.Applications_Link__c).toBe(`https://forms.example.com/admin/clients/${s.knownClient}`);

    const before = sf.writes.length;
    await startBackfill("apply", "staff:test");
    await runBackfillBatch(deps(sf), "staff:test");
    expect(sf.writes).toHaveLength(before); // links already there: nothing rewritten
  });

  it("pauses near the API limit and resumes where it stopped", async () => {
    let busy = false;
    const sf = mockSalesforce({ usage: () => ({ used: busy ? 14_000 : 10, max: 15_000 }) });
    await seed(sf);
    await startBackfill("dry_run", "staff:test");
    const db = await getDb();
    // Pause after the first Account.
    const original = sf.api.describe;
    let processed = 0;
    sf.api.describe = async (o) => original(o);
    const realUsage = sf.api.usage;
    sf.api.usage = () => {
      processed++;
      busy = processed > 1;
      return realUsage();
    };
    const paused = await runBackfillBatch(deps(sf), "staff:test");
    expect(paused.done).toBe(false);
    expect(paused.stoppedReason).toMatch(/API use/);
    busy = false;
    sf.api.usage = realUsage;
    const finished = await runBackfillBatch(deps(sf), "staff:test");
    expect(finished.done).toBe(true);
    const rows = await db.select().from(schema.salesforceBackfillRows).where(eq(schema.salesforceBackfillRows.runId, finished.runId));
    expect(new Set(rows.map((r) => r.accountId)).size).toBe(rows.length); // no Account processed twice
    expect((await getBackfillState())!.counts).toEqual(finished.counts);
  });
});
