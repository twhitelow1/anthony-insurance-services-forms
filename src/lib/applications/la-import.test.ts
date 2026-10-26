import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getForm } from "@/forms";
import { getDb, schema } from "@/lib/db";
import { getClient } from "@/lib/clients/repo";
import type { LaSubmission } from "@/lib/ghl/client";

// Lead Alchemist stand-in: the martial arts survey's submissions, two per page.
const la = vi.hoisted(() => ({ submissions: [] as LaSubmission[] }));
vi.mock("@/lib/ghl/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/ghl/client")>()),
  ghlConfig: async () => ({ token: "t", locationId: "LOC1" }),
  listCustomFields: async () => [
    { id: "cfEvent", name: "Name of Event", fieldKey: "contact.name_of_event", dataType: "TEXT" },
    { id: "cfOvernight", name: "Does your event have participants staying overnight?", fieldKey: "contact.overnight", dataType: "RADIO" },
    { id: "cfColor", name: "Favorite belt color", fieldKey: "contact.belt", dataType: "TEXT" },
  ],
  listLaSources: async (kind: string) => (kind === "survey" ? [{ id: "Bt8KGBOGa5n7THVJuqsY", name: "Martial Arts Event" }] : []),
  laSubmissionsPage: async (_kind: string, id: string, page: number, limit: number) => {
    const all = id === "Bt8KGBOGa5n7THVJuqsY" ? la.submissions : [];
    return { submissions: all.slice((page - 1) * limit, page * limit), total: all.length };
  },
}));

const uniq = () => Math.random().toString(36).slice(2, 8);
const ACTOR = "staff:amy@anthonyinsuranceservices.com";
const sub = (tag: string, n: number, extra: Partial<LaSubmission> = {}): LaSubmission => ({
  id: `sub-${tag}-${n}`,
  contactId: `la-${tag}-${n}`,
  createdAt: "2024-03-0" + n + "T15:00:00.000Z",
  name: `Kim Lee${n}`,
  email: `kim${n}.${tag}@gmail.com`,
  others: {
    __submissions_other_field__: "x",
    eventData: { page: { url: "https://martialartsschoolinsurance.com" } },
    first_name: "Kim",
    last_name: `Lee${n}`,
    email: `kim${n}.${tag}@gmail.com`,
    company_name: `Tiger Dojo ${tag} ${n}`,
    state: "TX",
    cfEvent: "Spring Open",
    cfOvernight: "yes",
    cfColor: "Black",
  },
  ...extra,
});

describe("importing old Lead Alchemist submissions", () => {
  it("matches answers to the form's questions and keeps the rest", async () => {
    const { mapSubmission, OTHER_ANSWERS } = await import("./la-import");
    const names = new Map([
      ["cfEvent", "Name of Event"],
      ["cfOvernight", "Does your event have participants staying overnight?"],
      ["cfColor", "Favorite belt color"],
    ]);
    const m = mapSubmission(getForm("martial-arts-event-application")!, sub("x", 1), names);
    expect(m.values).toMatchObject({
      first_name: "Kim",
      last_name: "Lee1",
      email: "kim1.x@gmail.com",
      legal_business_name: "Tiger Dojo x 1",
      mailing_state: "TX",
      event_name: "Spring Open",
      participants_overnight: "Yes", // matched to the option's own spelling
      [OTHER_ANSWERS]: ["Favorite belt color: Black"],
    });
    expect(m).toMatchObject({ email: "kim1.x@gmail.com", name: "Kim Lee1" });
  });

  it("imports every page once, quietly, with the original date, on the right account", async () => {
    const { importRunIds, importSubmissionPages } = await import("./la-import");
    const tag = uniq();
    la.submissions = [1, 2, 3].map((n) => sub(tag, n, { id: `sub-${tag}-${n - 1}` }));
    la.submissions.push(sub(tag, 4, { id: `sub-${tag}-noemail`, email: null, others: { first_name: "No" } }));
    const ids = await importRunIds();
    expect(ids).toEqual(["survey:Bt8KGBOGa5n7THVJuqsY:1"]);

    const r = await importSubmissionPages(ids, ACTOR);
    expect(r.notes.join(" ")).toMatch(/3 imported/);
    expect(r.notes.join(" ")).toMatch(/has no email/);
    const db = await getDb();
    const apps = await db.select().from(schema.applications).where(eq(schema.applications.laSubmissionId, `sub-${tag}-0`));
    expect(apps[0]).toMatchObject({ importedFrom: "lead_alchemist", formSlug: "martial-arts-event-application", status: "received", ghlContactId: `la-${tag}-1` });
    expect(apps[0].createdAt.toISOString()).toBe("2024-03-01T15:00:00.000Z");
    const account = await getClient(apps[0].clientId!);
    expect(account).toMatchObject({ name: `Tiger Dojo ${tag} 1`, source: "lead_alchemist" });
    const events = await db.select().from(schema.applicationEvents).where(eq(schema.applicationEvents.applicationId, apps[0].id));
    expect(events.map((e) => e.type)).toEqual(["imported"]); // no "submitted", no emails, no syncs

    // Running it again brings in nothing new.
    const again = await importSubmissionPages(ids, ACTOR);
    expect(again.notes.join(" ")).toMatch(/0 imported, 3 already here/);
  });

  it("imports only what's ticked: whole forms, or single submissions on a page", async () => {
    const { importRunIds, importSubmissionPages, listSourceSubmissions, pickedItem } = await import("./la-import");
    const tag = uniq();
    la.submissions = [1, 2, 3].map((n) => sub(tag, n, { id: `pick-${tag}-${n}` }));
    expect(await importRunIds(["form:SomeOtherForm1"])).toEqual([]); // not ticked → nothing
    expect(await importRunIds(["survey:Bt8KGBOGa5n7THVJuqsY"])).toEqual(["survey:Bt8KGBOGa5n7THVJuqsY:1"]);

    const key = "survey:Bt8KGBOGa5n7THVJuqsY";
    const r = await importSubmissionPages([pickedItem(key, 1, [`pick-${tag}-2`])], ACTOR);
    expect(r.notes.join(" ")).toMatch(/1 imported/);
    const list = await listSourceSubmissions(key, 1);
    const mine = list.rows.filter((x) => x.id.startsWith(`pick-${tag}`));
    expect(mine.map((x) => [x.id, !!x.applicationId])).toEqual([
      [`pick-${tag}-1`, false],
      [`pick-${tag}-2`, true],
      [`pick-${tag}-3`, false],
    ]);
    expect(mine[0]).toMatchObject({ name: "Kim Lee1", email: `kim1.${tag}@gmail.com` });
  });
});
