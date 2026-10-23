import { describe, expect, it } from "vitest";
import { aerialInstructorApplication as form } from "@/forms/aerial-instructor-application";
import { createApplication, getApplication } from "@/lib/applications/repo";
import { saveDraft } from "@/lib/applications/drafts";
import { assignApplicationClient, assignDraftClient, clientEmailsOf, ensureClient, getClient, listClientApplications, listClientEvents, listClients, mergeClients, splitClientEmail } from "./repo";
import { csvCell, matchesSearch, phoneDigits, searchTerms, toCsv } from "./text";

const uniq = () => Math.random().toString(36).slice(2, 8);

describe("client search helpers", () => {
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
});

describe("clients", () => {
  it("groups applications by email, and finds clients by name, email or phone", async () => {
    const tag = uniq();
    const email = `pat.${tag}@example.com`;
    const a1 = await createApplication(form, { email, first_name: "Pat", last_name: `Lee${tag}`, phone: "(555) 777-1234" }, {});
    const a2 = await createApplication(form, { email: email.toUpperCase(), first_name: "Pat", last_name: `Lee${tag}` }, {});
    const id1 = await assignApplicationClient(a1.id, { email, contactName: a1.applicantName, phone: "(555) 777-1234" });
    const id2 = await assignApplicationClient(a2.id, { email: email.toUpperCase(), contactName: a2.applicantName });
    expect(id1).toBe(id2);
    expect((await listClientApplications(id1)).map((a) => a.id).sort()).toEqual([a1.id, a2.id].sort());

    for (const q of [`lee${tag}`, email.toUpperCase(), "555-777-1234", "(555) 777 1234", "5557771234"]) {
      const { rows } = await listClients({ q });
      expect(rows.map((r) => r.id), q).toContain(id1);
    }
    const { rows } = await listClients({ q: `lee${tag}` });
    expect(rows[0]).toMatchObject({ applications: 2, phone: "(555) 777-1234", prospect: false, sfStatus: "not_synced" });
  });

  it("shows prospects who only started an application", async () => {
    const email = `prospect.${uniq()}@example.com`;
    const saved = await saveDraft(form, { ref: null, values: { email, first_name: "Pro", last_name: "Spect" }, step: 1 });
    const id = await assignDraftClient(saved!.draft.id, { email, contactName: "Pro Spect" });
    const { rows } = await listClients({ q: email });
    expect(rows.find((r) => r.id === id)).toMatchObject({ applications: 0, startedDrafts: 1, prospect: true, name: "Pro Spect" });
  });

  it("merges two clients and splits a mistaken merge, with an audit trail", async () => {
    const e1 = `one.${uniq()}@example.com`;
    const e2 = `two.${uniq()}@example.com`;
    const app2 = await createApplication(form, { email: e2, first_name: "Two", last_name: "Person" }, {});
    const c1 = await ensureClient({ email: e1, businessName: "Same Studio" });
    const c2 = await assignApplicationClient(app2.id, { email: e2, businessName: "Same Studio" });

    await mergeClients(c1, c2, "staff:amy@anthonyinsuranceservices.com");
    expect((await clientEmailsOf(c1)).sort()).toEqual([e1, e2].sort());
    expect((await getApplication(app2.id))!.clientId).toBe(c1);
    expect((await getClient(c2))!.id).toBe(c1); // the old record resolves to the merged one
    expect((await listClients({ q: e2 })).rows.map((r) => r.id)).toEqual([c1]);

    const split = await splitClientEmail(c1, e2, "staff:amy@anthonyinsuranceservices.com");
    expect(await clientEmailsOf(split)).toEqual([e2]);
    expect((await getApplication(app2.id))!.clientId).toBe(split);
    const log = (await listClientEvents(c1)).map((e) => e.type);
    expect(log).toEqual(expect.arrayContaining(["merged", "split"]));
    await expect(splitClientEmail(split, e2, "staff:x")).rejects.toThrow(/only email/);
  });

  it("refuses to merge clients linked to different Salesforce Accounts", async () => {
    const { setClientSalesforce } = await import("./repo");
    const a = await ensureClient({ email: `a.${uniq()}@example.com` });
    const b = await ensureClient({ email: `b.${uniq()}@example.com` });
    await setClientSalesforce(a, { sfAccountId: "001A" });
    await setClientSalesforce(b, { sfAccountId: "001B" });
    await expect(mergeClients(a, b, "staff:x")).rejects.toThrow(/different Salesforce Accounts/);
  });
});
