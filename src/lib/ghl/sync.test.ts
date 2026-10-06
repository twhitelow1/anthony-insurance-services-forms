import { afterEach, describe, expect, it, vi } from "vitest";
import { sportsFacilityApplication as form } from "@/forms/sports-facility-application";
import { createApplicationPdf, documentUrl, getDocument, latestDocument } from "@/lib/applications/documents";
import { createApplication } from "@/lib/applications/repo";
import { pruneValues } from "@/lib/forms/validate";
import { syncNewApplication, syncStatus } from "./sync";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Fake GHL API: records requests, answers the endpoints sync uses. */
function fakeGhl(existingOpportunities: { id: string; status?: string; pipelineId?: string }[] = []) {
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
    if (url.pathname === "/opportunities/") return json({ opportunity: { id: "opp1" } });
    if (url.pathname === "/opportunities/search") return json({ opportunities: existingOpportunities });
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

describe("GHL sync with pipeline", () => {
  it("writes the PDF link and opens an opportunity in the configured stage", async () => {
    vi.stubEnv("GHL_PIPELINE_ID", "pipe1");
    vi.stubEnv("GHL_PIPELINE_STAGE_ID", "stage-new");
    const calls = fakeGhl();
    const app = await newApp();

    const res = await syncNewApplication(form, app, "https://forms.example.com/documents/abc");
    expect(res).toEqual({ contactId: "c1", opportunityId: "opp1", opportunityReused: false, missingFields: [] });

    const upsert = calls.find((c) => c.path === "/contacts/upsert")!.body!;
    expect(upsert.customFields).toContainEqual({ id: "cf3", field_value: "https://forms.example.com/documents/abc" });
    const opp = calls.find((c) => c.path === "/opportunities/")!.body!;
    expect(opp).toMatchObject({ pipelineId: "pipe1", pipelineStageId: "stage-new", contactId: "c1", status: "open", locationId: "loc1" });
    expect(String(opp.name)).toContain(app.reference);
  });

  it("moves the lead's existing open opportunity instead of creating a duplicate", async () => {
    vi.stubEnv("GHL_PIPELINE_ID", "pipe1");
    vi.stubEnv("GHL_PIPELINE_STAGE_ID", "stage-app-submitted");
    const calls = fakeGhl([{ id: "lead-opp", status: "open", pipelineId: "pipe1" }]);
    const app = await newApp();

    const res = await syncNewApplication(form, app);
    expect(res).toMatchObject({ opportunityId: "lead-opp", opportunityReused: true });
    const search = calls.find((c) => c.path === "/opportunities/search")!;
    expect(search).toBeTruthy();
    expect(calls.some((c) => c.path === "/opportunities/")).toBe(false);
    expect(calls.find((c) => c.method === "PUT" && c.path === "/opportunities/lead-opp")!.body).toEqual({
      pipelineStageId: "stage-app-submitted",
    });
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
    });

    await syncStatus({ ...app, status: "bound" }, "in_review");
    expect(calls.filter((c) => c.path === "/opportunities/opp1").at(-1)!.body).toEqual({ pipelineStageId: "stage-bound", status: "won" });
  });
});
