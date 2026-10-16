import { afterEach, describe, expect, it, vi } from "vitest";
import { sportsFacilityApplication as form } from "@/forms/sports-facility-application";
import { createApplicationPdf, documentUrl, getDocument, latestDocument } from "@/lib/applications/documents";
import { createApplication } from "@/lib/applications/repo";
import { pruneValues } from "@/lib/forms/validate";
import { syncNewApplication, syncStartedApplication, syncStatus } from "./sync";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Fake Lead Alchemist API: records requests, answers the endpoints sync uses. */
function fakeGhl(
  existingOpportunities: { id: string; status?: string; pipelineId?: string; pipelineStageId?: string }[] = [],
  { goneContacts = [] as string[] } = {},
) {
  vi.stubEnv("GHL_API_TOKEN", "pit-test");
  vi.stubEnv("GHL_LOCATION_ID", "loc1");
  const calls: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.pathname.endsWith("/customFields"))
      return json({
        customFields: ["Application Reference", "Application Status", "Application Link", "Application PDF"].map((name, i) => ({
          id: `cf${i}`,
          name,
          fieldKey: `contact.f${i}`,
          dataType: "TEXT",
        })),
      });
    if (url.pathname === "/contacts/upsert") return json({ new: true, contact: { id: "c1" } });
    const contact = url.pathname.match(/^\/contacts\/([^/]+)$/)?.[1];
    if (contact && goneContacts.includes(contact)) return new Response(JSON.stringify({ message: "Contact not found" }), { status: 400 });
    if (url.pathname === "/opportunities/") return json({ opportunity: { id: "opp1" } });
    if (url.pathname === "/opportunities/search")
      return json({ opportunities: existingOpportunities.filter((o) => o.pipelineId === url.searchParams.get("pipeline_id")) });
    if (url.pathname === "/opportunities/pipelines")
      return json({
        pipelines: [
          {
            id: "pipe1",
            name: "Applications",
            stages: [
              { id: "stage-new", name: "New Lead" },
              { id: "stage-app-submitted", name: "Application Submitted" },
              { id: "stage-review", name: "In Review" },
              { id: "stage-bound", name: "Won" },
            ],
          },
          {
            id: "lead-pipe",
            name: "Leads",
            stages: [
              { id: "lead-new", name: "New" },
              { id: "lead-calendar", name: "Lead Calendar" },
            ],
          },
        ],
      });
    return json({});
  });
  return calls;
}

const newApp = () =>
  createApplication(form, pruneValues(form, { email: "lead@example.com", first_name: "Lee", legal_business_name: "Lee Gym" }), {});

describe("documents", () => {
  it("stores the generated PDF privately and returns the newest", async () => {
    const app = await newApp();
    const doc = await createApplicationPdf(form, app);
    expect(doc.content.subarray(0, 4).toString()).toBe("%PDF");
    expect(doc.filename).toBe(`${app.reference} Lee Gym - application.pdf`);
    expect((await getDocument(doc.id))?.size).toBe(doc.size);
    expect((await latestDocument(app.id))?.id).toBe(doc.id);
    expect(documentUrl(doc)).toBe(`https://forms.example.com/documents/${doc.id}`);
  });
});

describe("Lead Alchemist sync with pipeline", () => {
  it("writes the PDF link and opens an opportunity in the configured stage", async () => {
    vi.stubEnv("GHL_PIPELINE_ID", "pipe1");
    vi.stubEnv("GHL_PIPELINE_STAGE_ID", "stage-new");
    const calls = fakeGhl();
    const app = await newApp();

    const res = await syncNewApplication(form, app, "https://forms.example.com/documents/abc");
    expect(res).toEqual({
      contactId: "c1",
      matchedBy: "email",
      opportunityId: "opp1",
      movedFromLead: false,
      missingFields: [],
      missingOpportunityFields: [],
    });

    const upsert = calls.find((c) => c.path === "/contacts/upsert")!.body!;
    expect(upsert.customFields).toContainEqual({ id: "cf3", field_value: "https://forms.example.com/documents/abc" });
    const opp = calls.find((c) => c.path === "/opportunities/")!.body!;
    expect(opp).toMatchObject({ pipelineId: "pipe1", pipelineStageId: "stage-new", contactId: "c1", status: "open", locationId: "loc1" });
    expect(String(opp.name)).toContain(app.reference);
    // The opportunity carries this application's reference and PDF.
    expect(opp.customFields).toContainEqual({ id: "cf0", field_value: app.reference });
    expect(opp.customFields).toContainEqual({ id: "cf3", field_value: "https://forms.example.com/documents/abc" });
  });

  it("gives every application its own opportunity, even with one already open in the pipeline", async () => {
    vi.stubEnv("GHL_PIPELINE_ID", "pipe1");
    vi.stubEnv("GHL_PIPELINE_STAGE_ID", "stage-app-submitted");
    const calls = fakeGhl([{ id: "first-app-opp", status: "open", pipelineId: "pipe1" }]);
    const res = await syncNewApplication(form, await newApp());
    expect(res).toMatchObject({ opportunityId: "opp1", movedFromLead: false });
    expect(calls.some((c) => c.method === "PUT" && c.path === "/opportunities/first-app-opp")).toBe(false);
  });

  it("moves the lead out of the lead pipeline into the applications pipeline", async () => {
    vi.stubEnv("GHL_PIPELINE_ID", "Applications");
    vi.stubEnv("GHL_PIPELINE_STAGE_ID", "Application Submitted");
    vi.stubEnv("GHL_LEAD_PIPELINE_ID", "Leads");
    vi.stubEnv("GHL_LEAD_STAGE_ID", "Lead Calendar");
    const calls = fakeGhl([
      { id: "other-stage", status: "open", pipelineId: "lead-pipe", pipelineStageId: "lead-new" },
      { id: "lead-opp", status: "open", pipelineId: "lead-pipe", pipelineStageId: "lead-calendar" },
    ]);
    const app = await newApp();

    const res = await syncNewApplication(form, app, "https://forms.example.com/applications/x/pdf");
    expect(res).toMatchObject({ opportunityId: "lead-opp", movedFromLead: true });
    expect(calls.some((c) => c.path === "/opportunities/")).toBe(false);
    const put = calls.find((c) => c.method === "PUT" && c.path === "/opportunities/lead-opp")!.body!;
    expect(put).toMatchObject({ pipelineId: "pipe1", pipelineStageId: "stage-app-submitted" });
    expect(String(put.name)).toContain(app.reference);
    expect(put.customFields).toContainEqual({ id: "cf3", field_value: "https://forms.example.com/applications/x/pdf" });
  });

  it("creates a new opportunity when the lead pipeline has nothing open for them", async () => {
    vi.stubEnv("GHL_PIPELINE_ID", "pipe1");
    vi.stubEnv("GHL_PIPELINE_STAGE_ID", "stage-new");
    vi.stubEnv("GHL_LEAD_PIPELINE_ID", "Leads");
    fakeGhl();
    expect(await syncNewApplication(form, await newApp())).toMatchObject({ opportunityId: "opp1", movedFromLead: false });
  });

  it("updates the saved Lead Alchemist contact by ID instead of matching on email", async () => {
    const calls = fakeGhl();
    const res = await syncNewApplication(form, await newApp(), undefined, "saved-contact");
    expect(res).toMatchObject({ contactId: "saved-contact", matchedBy: "saved_id" });
    expect(calls.some((c) => c.path === "/contacts/upsert")).toBe(false);
    const put = calls.find((c) => c.method === "PUT" && c.path === "/contacts/saved-contact")!.body!;
    expect(put.email).toBeUndefined();
    expect(put.firstName).toBe("Lee");
    expect(calls.find((c) => c.path === "/contacts/saved-contact/tags")!.body!.tags).toContain("app-status:received");
    expect(calls.some((c) => c.path === "/contacts/saved-contact/notes")).toBe(true);
  });

  it("falls back to the email match when the saved contact was deleted in Lead Alchemist", async () => {
    const calls = fakeGhl([], { goneContacts: ["deleted"] });
    const res = await syncNewApplication(form, await newApp(), undefined, "deleted");
    expect(res).toMatchObject({ contactId: "c1", matchedBy: "email" });
    expect(calls.some((c) => c.path === "/contacts/upsert")).toBe(true);
  });

  it("accepts pipeline and stage names as shown in Lead Alchemist, not just IDs", async () => {
    vi.stubEnv("GHL_PIPELINE_ID", "applications");
    vi.stubEnv("GHL_PIPELINE_STAGE_ID", "Application Submitted");
    const calls = fakeGhl();
    const app = await newApp();
    await syncNewApplication(form, app);
    expect(calls.find((c) => c.path === "/opportunities/")!.body).toMatchObject({
      pipelineId: "pipe1",
      pipelineStageId: "stage-app-submitted",
    });
  });

  it("explains a stage name that doesn't exist", async () => {
    vi.stubEnv("GHL_PIPELINE_ID", "pipe1");
    vi.stubEnv("GHL_PIPELINE_STAGE_ID", "Submited");
    fakeGhl();
    await expect(syncNewApplication(form, await newApp())).rejects.toThrow(/isn't a stage of "Applications".*Application Submitted/);
  });

  it("skips the opportunity when no pipeline is configured", async () => {
    const calls = fakeGhl();
    const res = await syncNewApplication(form, await newApp());
    expect(res.opportunityId).toBeUndefined();
    expect(calls.some((c) => c.path === "/opportunities/")).toBe(false);
  });

  it("moves the opportunity stage on status changes and closes it when bound", async () => {
    vi.stubEnv("GHL_PIPELINE_ID", "pipe1");
    vi.stubEnv("GHL_PIPELINE_STAGE_ID", "stage-new");
    vi.stubEnv("GHL_STAGE_IDS", JSON.stringify({ in_review: "stage-review", bound: "stage-bound" }));
    const calls = fakeGhl();
    const app = { ...(await newApp()), ghlContactId: "c1", ghlOpportunityId: "opp1" };

    await syncStatus({ ...app, status: "in_review" }, "received");
    expect(calls.find((c) => c.method === "PUT" && c.path === "/opportunities/opp1")!.body).toEqual({
      pipelineStageId: "stage-review",
      status: "open",
      customFields: [{ id: "cf1", field_value: "In review" }],
    });

    await syncStatus({ ...app, status: "bound" }, "in_review");
    expect(calls.filter((c) => c.path === "/opportunities/opp1").at(-1)!.body).toMatchObject({
      pipelineStageId: "stage-bound",
      status: "won",
    });
  });
});

describe("started (unfinished) applications", () => {
  it("tags the contact app-started, and submitting removes those tags", async () => {
    const calls = fakeGhl();
    await syncStartedApplication(form, { email: "lead@example.com", first_name: "Lee" });
    const upsert = calls.find((c) => c.path === "/contacts/upsert")!.body!;
    expect(upsert.tags).toEqual(expect.arrayContaining(["app-started", "app-started:sports-facility-application"]));

    await syncNewApplication(form, await newApp());
    const removed = calls.find((c) => c.method === "DELETE" && c.path === "/contacts/c1/tags")!.body!;
    expect(removed.tags).toEqual(["app-started", "app-started:sports-facility-application"]);
  });
});
