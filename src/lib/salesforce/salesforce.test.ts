import { afterEach, describe, expect, it, vi } from "vitest";
import { aerialInstructorApplication as form } from "@/forms/aerial-instructor-application";
import { createApplication, getApplication, setGhlIds } from "@/lib/applications/repo";
import { createApplicationPdf } from "@/lib/applications/documents";
import { getClient } from "@/lib/clients/repo";
import { linksFor } from "@/lib/integrations/urls";
import type { FormValues } from "@/lib/forms/types";
import { mockGhlLinks, mockSalesforce } from "@/test/salesforce-mock";
import { describes } from "@/test/salesforce-mock";
import { matchSalesforce } from "./match";
import { accountCandidates, chooseStage, closeDate, opportunityName, participants, picklistMatch, prepareFields } from "./mapping";
import { PermanentSyncError, syncApplicationToSalesforce, type SyncDeps } from "./sync";
import { BACKOFF_MS, enqueueSalesforceSync, MAX_ATTEMPTS, runJob, syncNow } from "./jobs";
import { dryRunApi, redact } from "./dry-run";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

afterEach(() => vi.restoreAllMocks());

const LINKS = linksFor({
  salesforce: "https://org.lightning.force.com",
  ghl: "https://app.leadalchemist.example",
  ghlLocationId: "LOC1",
  app: "https://forms.example.com",
});

const values = (over: FormValues = {}): FormValues => ({
  first_name: "Alexa",
  last_name: "Prussin",
  email: `alexa.${Math.random().toString(36).slice(2, 8)}@example.com`,
  phone: "(555) 010-0100",
  requested_effective_date: "2026-11-01",
  general_aggregate_limit: "$2,000,000",
  ...over,
});

async function newApp(over: FormValues = {}, meta: { isTest?: boolean } = {}) {
  const app = await createApplication(form, values(over), meta);
  await createApplicationPdf(form, app);
  return app;
}

const deps = (sf: ReturnType<typeof mockSalesforce>, ghl = mockGhlLinks(), over: Partial<SyncDeps> = {}): SyncDeps => ({
  sf: sf.api,
  ghl: ghl.writer,
  links: LINKS,
  dryRun: false,
  stageMap: {},
  now: new Date("2026-10-23T12:00:00Z"),
  ...over,
});

describe("matching", () => {
  it("uses the Account of a Contact with the same email, ignoring case and spaces", async () => {
    const sf = mockSalesforce();
    const acc = await sf.api.create("Account", { Name: "Alexa Prussin", Phone: "555-010-0100" });
    const con = await sf.api.create("Contact", { AccountId: acc.id, Email: "Alexa@Example.com", LastName: "P" });
    expect(await matchSalesforce(sf.api, { email: "  alexa@example.com ", accountName: "Someone Else" })).toMatchObject({
      kind: "contact",
      accountId: acc.id,
      contactId: con.id,
    });
  });

  it("falls back to an Account with the same name and phone (any phone format)", async () => {
    const sf = mockSalesforce();
    const acc = await sf.api.create("Account", { Name: "Bounce Barn", Phone: "+1 (555) 010-0100" });
    expect(await matchSalesforce(sf.api, { email: "new@example.com", accountName: "Bounce Barn", phone: "555.010.0100" })).toMatchObject({
      kind: "account",
      accountId: acc.id,
    });
  });

  it("doesn't guess when the match is uncertain", async () => {
    const sf = mockSalesforce();
    await sf.api.create("Account", { Name: "Bounce Barn", Phone: "555-999-0000" });
    expect((await matchSalesforce(sf.api, { email: "a@example.com", accountName: "Bounce Barn", phone: "555-010-0100" })).kind).toBe("review");
    expect((await matchSalesforce(sf.api, { email: "a@example.com", accountName: "Bounce Barn" })).kind).toBe("review");
    const a1 = await sf.api.create("Account", { Name: "One" });
    const a2 = await sf.api.create("Account", { Name: "Two" });
    await sf.api.create("Contact", { AccountId: a1.id, Email: "dup@example.com" });
    await sf.api.create("Contact", { AccountId: a2.id, Email: "dup@example.com" });
    expect(await matchSalesforce(sf.api, { email: "dup@example.com", accountName: "X" })).toMatchObject({ kind: "review" });
  });

  it("is a new client when nothing matches", async () => {
    expect(await matchSalesforce(mockSalesforce().api, { email: "fresh@example.com", accountName: "Fresh Studio", phone: "5550100" })).toEqual({ kind: "new" });
  });

  it("escapes quotes in names and emails", async () => {
    const sf = mockSalesforce();
    await matchSalesforce(sf.api, { email: "o'neil@example.com", accountName: "O'Neil's Gym" });
    expect(sf.queries.join("\n")).toContain("o\\'neil@example.com");
    expect(sf.queries.join("\n")).toContain("O\\'Neil\\'s Gym");
  });
});

describe("field mapping", () => {
  const account = describes().Account;

  it("checks picklist values against the org and uses its spelling", () => {
    const program = account.fields.find((f) => f.name === "Program__c")!;
    expect(picklistMatch(program, "aerial instructor")).toBe("Aerial Instructor");
    expect(picklistMatch(program, "Underwater Basket Weaving")).toBeNull();
  });

  it("skips missing fields and unknown picklist values instead of failing", () => {
    const { data, skipped } = prepareFields(account, {
      Program__c: ["Nope", "Aerial Instructor"],
      Legal_Entity__c: "Trust",
      Not_A_Field__c: "x",
      GL_Aggregate_Limit__c: "2,000,000",
      Effective_Date__c: "11/01/2026",
    });
    expect(data).toEqual({ Program__c: "Aerial Instructor", GL_Aggregate_Limit__c: 2000000 });
    expect(skipped.map((s) => s.field).sort()).toEqual(["Effective_Date__c", "Legal_Entity__c", "Not_A_Field__c"]);
    expect(skipped.find((s) => s.field === "Not_A_Field__c")!.reason).toBe("missing field: Account.Not_A_Field__c");
  });

  it("maps an aerial instructor application onto the Account", () => {
    expect(accountCandidates({ formSlug: "aerial-instructor-application", values: values() })).toMatchObject({
      Program__c: ["Aerial Instructor"],
      Legal_Entity__c: "Individual",
      GL_Aggregate_Limit__c: 2000000,
      Effective_Date__c: "2026-11-01",
      Contact_First_Name__c: "Alexa",
    });
    expect(participants({ youth_participants: "10", adult_participants: "5" })).toBe(15);
    expect(participants({ number_of_participants: "40" })).toBe(40);
  });

  it("names the Opportunity '<Account Name> - <year>' with a Close Date", () => {
    expect(opportunityName("Alexa Prussin", { requested_effective_date: "2027-01-15" })).toBe("Alexa Prussin - 2027");
    expect(opportunityName("Alexa Prussin", {}, new Date("2026-10-23"))).toBe("Alexa Prussin - 2026");
    expect(closeDate({}, new Date("2026-10-23T00:00:00Z"))).toBe("2026-11-22");
  });

  it("never picks Closed Won for an application that isn't bound", () => {
    const stages = [
      { label: "Closed Won", isClosed: true, isWon: true, sortOrder: 9 },
      { label: "Prospecting", isClosed: false, isWon: false, sortOrder: 1 },
      { label: "Closed Lost", isClosed: true, isWon: false, sortOrder: 10 },
    ];
    expect(chooseStage(stages, "received").stage).toBe("Prospecting");
    expect(chooseStage(stages, "bound").stage).toBe("Closed Won");
    expect(chooseStage(stages, "declined").stage).toBe("Closed Lost");
    expect(chooseStage(stages, "quoted", { quoted: "closed won" }).stage).toBe("Closed Won");
    expect(chooseStage(stages, "received", { received: "Qualification" })).toMatchObject({ stage: "Prospecting" });
  });

  it("keeps personal details out of dry-run logs", () => {
    expect(redact({ Name: "Alexa Prussin", Email: "a@b.c", Program__c: "Aerial Instructor" })).toEqual({
      Name: "[redacted]",
      Email: "[redacted]",
      Program__c: "Aerial Instructor",
    });
  });
});

describe("sync an application to Salesforce", () => {
  it("creates the Account, Contact and Opportunity for a new client, with the PDF, a note and every link", async () => {
    const sf = mockSalesforce();
    const ghl = mockGhlLinks();
    const app = await newApp();
    await setGhlIds(app.id, { contactId: "lac1", opportunityId: "lao1" });
    const out = await syncApplicationToSalesforce(app.id, deps(sf, ghl));
    expect(out.status).toBe("synced");
    expect(sf.creates().map((w) => w.object)).toEqual(["Account", "Contact", "Opportunity", "ContentVersion", "FeedItem"]);

    const account = sf.records.Account[0];
    expect(account).toMatchObject({
      Name: "Alexa Prussin",
      Type: "Customer",
      Legal_Entity__c: "Individual",
      Program__c: "Aerial Instructor",
      GL_Aggregate_Limit__c: 2000000,
      Effective_Date__c: "2026-11-01",
    });
    const synced = (await getApplication(app.id))!;
    const client = (await getClient(synced.clientId!))!;
    expect(account.Applications_Link__c).toBe(`https://forms.example.com/admin/clients/${client.id}`);
    expect(account.LA_Contact_Link__c).toBe("https://app.leadalchemist.example/v2/location/LOC1/contacts/detail/lac1");
    expect(account.LA_Opportunity_Link__c).toBe("https://app.leadalchemist.example/v2/location/LOC1/opportunities/list/lao1?tab=OpportunityDetails");
    expect(sf.records.Contact[0]).toMatchObject({ AccountId: account.Id, FirstName: "Alexa", LastName: "Prussin", Email: app.applicantEmail });
    expect(sf.records.Opportunity[0]).toMatchObject({
      AccountId: account.Id,
      Name: "Alexa Prussin - 2026",
      StageName: "Prospecting",
      CloseDate: "2026-11-01",
      Application_Link__c: `https://forms.example.com/admin/applications/${app.id}`,
    });
    expect(sf.records.ContentVersion[0]).toMatchObject({ FirstPublishLocationId: account.Id });
    expect(String(sf.records.FeedItem[0].Body)).toContain(app.reference);

    // Stored on the client and the application.
    expect(client).toMatchObject({ sfAccountId: account.Id, sfContactId: sf.records.Contact[0].Id, sfStatus: "linked" });
    expect(synced).toMatchObject({ sfOpportunityId: sf.records.Opportunity[0].Id, sfSyncStatus: "synced" });

    // And the Salesforce links went back into Lead Alchemist, with one note.
    expect(ghl.calls.find((c) => c.kind === "contact")!.data).toEqual({
      salesforceAccount: `https://org.lightning.force.com/lightning/r/Account/${account.Id}/view`,
      clientPage: `https://forms.example.com/admin/clients/${client.id}`,
    });
    expect(ghl.calls.find((c) => c.kind === "opportunity")).toMatchObject({ id: "lao1" });
    expect(ghl.calls.filter((c) => c.kind === "note")).toHaveLength(1);
  });

  it("is idempotent: running it again creates nothing new", async () => {
    const sf = mockSalesforce();
    const ghl = mockGhlLinks();
    const app = await newApp();
    await setGhlIds(app.id, { contactId: "lac1", opportunityId: "lao1" });
    await syncApplicationToSalesforce(app.id, deps(sf, ghl));
    const before = sf.creates().length;
    const again = await syncApplicationToSalesforce(app.id, deps(sf, ghl));
    expect(again).toMatchObject({ status: "synced", created: [] });
    expect(sf.creates()).toHaveLength(before);
    expect(ghl.calls.filter((c) => c.kind === "note")).toHaveLength(1);
  });

  it("puts a second application from the same client on the same Account, with its own Opportunity", async () => {
    const sf = mockSalesforce();
    const first = await newApp();
    await syncApplicationToSalesforce(first.id, deps(sf));
    const second = await newApp({ email: first.applicantEmail, requested_effective_date: "2027-11-01" });
    await syncApplicationToSalesforce(second.id, deps(sf));
    expect(sf.creates("Account")).toHaveLength(1);
    expect(sf.creates("Contact")).toHaveLength(1);
    expect(sf.records.Opportunity.map((o) => o.Name)).toEqual(["Alexa Prussin - 2026", "Alexa Prussin - 2027"]);
  });

  it("links an existing Salesforce client by email and only fills empty Account fields", async () => {
    const sf = mockSalesforce();
    const app = await newApp();
    const acc = await sf.api.create("Account", { Name: "Alexa P.", Program__c: "Gymnastics", Effective_Date__c: null });
    await sf.api.create("Contact", { AccountId: acc.id, Email: app.applicantEmail.toUpperCase(), LastName: "P" });
    await syncApplicationToSalesforce(app.id, deps(sf));
    expect(sf.creates("Account")).toHaveLength(1); // only the one made above
    expect(sf.creates("Contact")).toHaveLength(1);
    expect(sf.records.Account[0]).toMatchObject({ Program__c: "Gymnastics", Effective_Date__c: "2026-11-01" });
    expect(sf.records.Opportunity[0].Name).toBe("Alexa P. - 2026");
  });

  it("creates nothing and flags the application when the match is uncertain", async () => {
    const sf = mockSalesforce();
    await sf.api.create("Account", { Name: "Alexa Prussin", Phone: "555-999-1234" });
    const app = await newApp();
    const out = await syncApplicationToSalesforce(app.id, deps(sf));
    expect(out.status).toBe("needs_review");
    expect(sf.creates()).toHaveLength(1);
    const synced = (await getApplication(app.id))!;
    expect(synced.sfSyncStatus).toBe("needs_review");
    expect((await getClient(synced.clientId!))!.sfStatus).toBe("needs_review");
  });

  it("never sends test submissions", async () => {
    const sf = mockSalesforce();
    const app = await newApp({}, { isTest: true });
    expect((await syncApplicationToSalesforce(app.id, deps(sf))).status).toBe("skipped");
    expect(sf.writes).toHaveLength(0);
    expect(sf.queries).toHaveLength(0);
  });

  it("skips missing link fields with a clear report instead of failing", async () => {
    const sf = mockSalesforce({ withoutFields: ["Account.Applications_Link__c", "Opportunity.Application_Link__c"] });
    const app = await newApp();
    const out = await syncApplicationToSalesforce(app.id, deps(sf));
    expect(out).toMatchObject({ status: "synced", missingLinkFields: ["Opportunity.Application_Link__c", "Account.Applications_Link__c"] });
  });

  it("writes nothing in dry run, and stores no IDs", async () => {
    const sf = mockSalesforce();
    const ghl = mockGhlLinks();
    const app = await newApp();
    const out = await syncApplicationToSalesforce(app.id, deps(sf, ghl, { dryRun: true }));
    expect(out.status).toBe("dry_run");
    if (out.status !== "dry_run") return;
    expect(out.planned.map((p) => `${p.op} ${p.object}`)).toEqual([
      "create Account",
      "create Contact",
      "create Opportunity",
      "upload ContentVersion",
      "post FeedItem",
      "update Account",
      "update Contact",
    ]);
    expect(JSON.stringify(out.planned)).not.toContain("Alexa");
    expect(sf.writes).toHaveLength(0);
    expect(ghl.calls).toHaveLength(0);
    const after = (await getApplication(app.id))!;
    expect(after.sfOpportunityId).toBeNull();
    expect((await getClient(after.clientId!))!.sfAccountId).toBeNull();
  });
});

describe("sync queue", () => {
  it("retries with backoff, then marks the application failed after the last attempt", async () => {
    const sf = mockSalesforce({ failWith: () => new Error("Salesforce is down") });
    const app = await newApp();
    const jobId = await enqueueSalesforceSync(app.id);
    const db = await getDb();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const before = Date.now();
      const r = await runJob(jobId, deps(sf));
      expect(r.error).toBe("Salesforce is down");
      const [job] = await db.select().from(schema.syncJobs).where(eq(schema.syncJobs.id, jobId));
      expect(job.attempts).toBe(attempt);
      if (attempt < MAX_ATTEMPTS) {
        expect(job.status).toBe("pending");
        expect(job.nextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(BACKOFF_MS[attempt - 1] - 1000);
        expect((await getApplication(app.id))!.sfSyncStatus).toBe("pending");
      } else {
        expect(job.status).toBe("failed");
      }
    }
    const failed = (await getApplication(app.id))!;
    expect(failed).toMatchObject({ sfSyncStatus: "error", sfLastError: "Salesforce is down" });
  });

  it("doesn't retry a permanent error, and the retry button starts over", async () => {
    let broken = true;
    const sf = mockSalesforce({ failWith: () => (broken ? new PermanentSyncError("bad setup") : null) });
    const app = await newApp();
    const r = await runJob(await enqueueSalesforceSync(app.id), deps(sf));
    expect(r).toMatchObject({ error: "bad setup", final: true });
    broken = false;
    const retry = await syncNow(app.id, deps(sf));
    expect(retry.outcome?.status).toBe("synced");
    expect((await getApplication(app.id))!.sfSyncStatus).toBe("synced");
  });

  it("keeps one open job per application", async () => {
    const app = await newApp();
    expect(await enqueueSalesforceSync(app.id)).toBe(await enqueueSalesforceSync(app.id));
  });
});

describe("dry-run wrapper", () => {
  it("reads through and records writes with placeholder IDs", async () => {
    const sf = mockSalesforce();
    const dry = dryRunApi(sf.api);
    const { id } = await dry.create("Account", { Name: "X" });
    expect(id).toMatch(/^dry-run:Account:/);
    expect(sf.writes).toHaveLength(0);
    expect((await dry.describe("Account")).name).toBe("Account");
  });
});
