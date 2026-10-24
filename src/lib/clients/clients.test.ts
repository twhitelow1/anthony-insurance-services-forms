import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { aerialInstructorApplication as form } from "@/forms/aerial-instructor-application";
import { createApplication, getApplication } from "@/lib/applications/repo";
import { saveDraft } from "@/lib/applications/drafts";
import { getDb } from "@/lib/db";
import {
  assignApplicationClient,
  assignDraftClient,
  ensureClient,
  getClient,
  getContactByEmail,
  keepSeparate,
  listAccountContacts,
  listClientApplications,
  listClientEvents,
  listClients,
  mergeClients,
  resolveAccountAndContact,
  splitContact,
} from "./repo";
import { businessDomain, csvCell, matchesSearch, nameKey, phoneDigits, searchTerms, toCsv, websiteDomain } from "./text";

const uniq = () => Math.random().toString(36).slice(2, 8);

describe("account search and matching helpers", () => {
  it("normalizes phone numbers in any format", () => {
    expect(phoneDigits("(555) 010-0100")).toBe("5550100100");
    expect(phoneDigits("+1 555.010.0100")).toBe("5550100100");
    expect(phoneDigits("555 010 0100")).toBe("5550100100");
  });

  it("matches names and emails case-insensitively, and phones on digits", () => {
    const text = "bounce barn pat lee pat@example.com 5550100100";
    expect(matchesSearch(text, "BOUNCE")).toBe(true);
    expect(matchesSearch(text, "Pat@Example.com")).toBe(true);
    expect(matchesSearch(text, "(555) 010-0100")).toBe(true);
    expect(matchesSearch(text, "010-0100")).toBe(true);
    expect(matchesSearch(text, "zzz")).toBe(false);
    expect(searchTerms("Pat Lee").digits).toBeNull();
  });

  it("writes CSV that spreadsheets can't run as formulas", () => {
    expect(csvCell('He said "hi", then left')).toBe('"He said ""hi"", then left"');
    expect(csvCell("=HYPERLINK(\"evil\")")).toBe('"\'=HYPERLINK(""evil"")"');
    expect(csvCell("+15550100")).toBe("'+15550100");
    expect(toCsv(["a", "b"], [[1, null]])).toBe("a,b\r\n1,\r\n");
  });

  it("compares business names without punctuation, & or LLC/Inc/Co/The", () => {
    expect(nameKey("The Dance Co., LLC")).toBe("dance");
    expect(nameKey("Smith & Sons, Inc.")).toBe("smith and sons");
    expect(nameKey("  Aerial   Arts L.L.C. ")).toBe("aerial arts");
    expect(nameKey("Coastal Gymnastics")).toBe("coastal gymnastics");
  });

  it("applies the same name rule in the database migration as in the app", async () => {
    const db = await getDb();
    const names = ["The Dance Co., LLC", "Smith & Sons, Inc.", "Aerial Arts L.L.C.", "Coastal Gymnastics", "CO-OP Fitness"];
    for (const n of names) {
      const rows = (await db.execute(
        sql`select trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(${n}), '&', ' and ', 'g'), '[^a-z0-9 ]', ' ', 'g'), '\\m(the|llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited|pllc|lp|llp)\\M', ' ', 'g'), '\\s+', ' ', 'g')) as k`,
      )) as unknown as { rows?: { k: string }[] } | { k: string }[];
      const k = Array.isArray(rows) ? rows[0].k : rows.rows![0].k;
      expect(k, n).toBe(nameKey(n));
    }
  });

  it("only counts business email domains and real websites", () => {
    expect(businessDomain("pat@gmail.com")).toBeNull();
    expect(businessDomain("Pat@AcmeDance.com")).toBe("acmedance.com");
    expect(websiteDomain("https://www.acmedance.com/about")).toBe("acmedance.com");
    expect(websiteDomain("call 555-0100")).toBeNull();
  });
});

describe("accounts and contacts", () => {
  it("puts an individual's applications on one account and one contact, findable by name, email or phone", async () => {
    const tag = uniq();
    const email = `pat.${tag}@example.com`;
    const a1 = await createApplication(form, { email, first_name: "Pat", last_name: `Lee${tag}`, phone: "(555) 777-1234" }, {});
    const a2 = await createApplication(form, { email: email.toUpperCase(), first_name: "Pat", last_name: `Lee${tag}` }, {});
    const id1 = await assignApplicationClient(a1.id, { email, contactName: a1.applicantName, phone: "(555) 777-1234" });
    const id2 = await assignApplicationClient(a2.id, { email: email.toUpperCase(), contactName: a2.applicantName });
    expect(id1).toBe(id2);
    expect((await getClient(id1))!.isIndividual).toBe(true);
    const contact = await getContactByEmail(email);
    expect((await getApplication(a1.id))!.contactId).toBe(contact!.id);
    expect((await listClientApplications(id1)).map((a) => [a.id, a.contactName])).toEqual(
      expect.arrayContaining([[a1.id, contact!.name], [a2.id, contact!.name]]),
    );

    for (const q of [`lee${tag}`, email.toUpperCase(), "555-777-1234", "(555) 777 1234", "5557771234"]) {
      const { rows } = await listClients({ q });
      expect(rows.map((r) => r.id), q).toContain(id1);
    }
    const { rows } = await listClients({ q: `lee${tag}` });
    expect(rows[0]).toMatchObject({ applications: 2, contacts: 1, phone: "(555) 777-1234", prospect: false, sfStatus: "not_synced", isIndividual: true });
  });

  it("puts two people from the same business on one account when the phone matches", async () => {
    const biz = `Studio ${uniq()} LLC`;
    const one = await resolveAccountAndContact({ email: `owner.${uniq()}@gmail.com`, contactName: "Ann Owner", businessName: biz, phone: "555-200-3000" });
    const two = await resolveAccountAndContact({ email: `manager.${uniq()}@yahoo.com`, contactName: "Bo Manager", businessName: biz.replace(" LLC", ", L.L.C."), phone: "(555) 200-3000" });
    expect(one.match).toBe("new");
    expect(two).toMatchObject({ clientId: one.clientId, match: "strong" });
    expect(two.contactId).not.toBe(one.contactId);
    expect((await listAccountContacts(one.clientId)).map((c) => c.name).sort()).toEqual(["Ann Owner", "Bo Manager"]);
  });

  it("also matches the same business by its email domain", async () => {
    const biz = `Domain Gym ${uniq()}`;
    const domain = `${uniq()}gym.com`;
    const one = await resolveAccountAndContact({ email: `a@${domain}`, businessName: biz });
    const two = await resolveAccountAndContact({ email: `b@${domain}`, businessName: biz });
    expect(two).toMatchObject({ clientId: one.clientId, match: "strong" });
  });

  it("keeps a same-named business apart and flags it as a possible duplicate", async () => {
    const biz = `Name Only ${uniq()}`;
    const one = await resolveAccountAndContact({ email: `x.${uniq()}@gmail.com`, businessName: biz, phone: "555-111-1111" });
    const two = await resolveAccountAndContact({ email: `y.${uniq()}@gmail.com`, businessName: biz, phone: "555-999-9999" });
    expect(two.match).toBe("review");
    expect(two.clientId).not.toBe(one.clientId);
    expect((await getClient(two.clientId))!.possibleDuplicateOf).toBe(one.clientId);
    expect((await listClients({ filter: "review", q: biz })).rows.map((r) => r.id)).toEqual([two.clientId]);
    await keepSeparate(two.clientId, "staff:amy@anthonyinsuranceservices.com");
    expect((await getClient(two.clientId))!.possibleDuplicateOf).toBeNull();
  });

  it("an existing contact applying for their business goes to that business's account", async () => {
    const email = `repeat.${uniq()}@example.com`;
    const biz = `Repeat Fitness ${uniq()}`;
    const first = await resolveAccountAndContact({ email, contactName: "Re Peat", businessName: biz });
    const again = await resolveAccountAndContact({ email, contactName: "Re Peat", businessName: biz.toUpperCase() });
    expect(again).toMatchObject({ clientId: first.clientId, contactId: first.contactId, match: "contact" });
  });

  it("shows prospects who only started an application", async () => {
    const email = `prospect.${uniq()}@example.com`;
    const saved = await saveDraft(form, { ref: null, values: { email, first_name: "Pro", last_name: "Spect" }, step: 1 });
    const id = await assignDraftClient(saved!.draft.id, { email, contactName: "Pro Spect" });
    const { rows } = await listClients({ q: email });
    expect(rows.find((r) => r.id === id)).toMatchObject({ applications: 0, startedDrafts: 1, prospect: true, name: "Pro Spect" });
  });

  it("merges two accounts and splits a contact off again, with an audit trail", async () => {
    const e1 = `one.${uniq()}@gmail.com`;
    const e2 = `two.${uniq()}@gmail.com`;
    const app2 = await createApplication(form, { email: e2, first_name: "Two", last_name: "Person" }, {});
    const c1 = await ensureClient({ email: e1, businessName: "Same Studio", phone: "555-000-0001" });
    const c2 = await assignApplicationClient(app2.id, { email: e2, contactName: "Two Person", businessName: "Same Studio", phone: "555-000-0002" });
    expect(c2).not.toBe(c1);

    await mergeClients(c1, c2, "staff:amy@anthonyinsuranceservices.com");
    expect((await listAccountContacts(c1)).map((c) => c.primaryEmail).sort()).toEqual([e1, e2].sort());
    expect((await getApplication(app2.id))!.clientId).toBe(c1);
    expect((await getClient(c2))!.id).toBe(c1); // the old record resolves to the merged one
    expect((await listClients({ q: e2 })).rows.map((r) => r.id)).toEqual([c1]);

    const person = (await getContactByEmail(e2))!;
    const split = await splitContact(c1, person.id, "staff:amy@anthonyinsuranceservices.com");
    expect((await listAccountContacts(split)).map((c) => c.id)).toEqual([person.id]);
    expect((await getApplication(app2.id))!.clientId).toBe(split);
    const log = (await listClientEvents(c1)).map((e) => e.type);
    expect(log).toEqual(expect.arrayContaining(["merged", "split"]));
    await expect(splitContact(split, person.id, "staff:x")).rejects.toThrow(/only contact/);
  });

  it("refuses to merge accounts linked to different Salesforce Accounts", async () => {
    const { setClientSalesforce } = await import("./repo");
    const a = await ensureClient({ email: `a.${uniq()}@example.com` });
    const b = await ensureClient({ email: `b.${uniq()}@example.com` });
    await setClientSalesforce(a, { sfAccountId: "001A" });
    await setClientSalesforce(b, { sfAccountId: "001B" });
    await expect(mergeClients(a, b, "staff:x")).rejects.toThrow(/different Salesforce Accounts/);
  });
});
