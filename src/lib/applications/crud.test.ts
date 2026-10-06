import { describe, expect, it, vi } from "vitest";
import { sportsFacilityApplication as form } from "@/forms/sports-facility-application";
import { pruneValues } from "@/lib/forms/validate";
import type { FormValues } from "@/lib/forms/types";
import { getSession, verify } from "@/lib/auth/session";
import { createApplicationPdf, createCarrierPdf, listDocuments, mainDocument } from "./documents";
import { receiptPath, RECEIPT_AUDIENCE } from "./receipt";
import {
  createApplication,
  deleteApplication,
  getApplication,
  getEvents,
  listApplicants,
  searchApplications,
  updateAnswers,
} from "./repo";

const answers = (over: FormValues = {}): FormValues =>
  pruneValues(form, {
    first_name: "Pat",
    last_name: "Lee",
    email: `pat.${Math.random().toString(36).slice(2, 8)}@example.com`,
    legal_business_name: "Bounce Barn",
    mailing_state: "TX",
    business_entity: "LLC",
    has_trampolines: "No",
    signature: "data:image/png;base64,iVBORw0KGgo=",
    ...over,
  });

describe("applications CRUD", () => {
  it("edits answers, keeps the signature, re-indexes search and logs what changed", async () => {
    const app = await createApplication(form, answers(), {});
    const { signature: _sig, ...withoutSignature } = answers({ email: app.applicantEmail, legal_business_name: "Bounce Barn Two", has_trampolines: "Yes", trampoline_count: "3" });
    void _sig;
    const result = await updateAnswers(form, app.id, withoutSignature, "staff:amy@anthonyinsuranceservices.com");

    expect(result?.app.businessName).toBe("Bounce Barn Two");
    expect(result?.app.signature).toBe(app.signature);
    expect(result?.changed).toEqual(expect.arrayContaining(["Legal Business Name", "Do You Have Trampolines?", "Number of Trampolines"]));
    expect(result?.changed).not.toContain("Applicant's Signature");
    const [event] = await getEvents(app.id);
    expect(event.type).toBe("answers_edited");
    expect(event.actor).toBe("staff:amy@anthonyinsuranceservices.com");
    expect(event.clientVisible).toBe(false);
    expect((await searchApplications({ q: "Bounce Barn Two" })).map((a) => a.id)).toContain(app.id);
  });

  it("deletes an application with its documents and log", async () => {
    const app = await createApplication(form, answers(), {});
    await createApplicationPdf(form, app);
    expect((await deleteApplication(app.id))?.reference).toBe(app.reference);
    expect(await getApplication(app.id)).toBeUndefined();
    expect(await listDocuments(app.id)).toEqual([]);
    expect(await getEvents(app.id)).toEqual([]);
  });

  it("groups applications by applicant email", async () => {
    const email = `group.${Date.now()}@example.com`;
    await createApplication(form, answers({ email, legal_business_name: "First Gym" }), {});
    await createApplication(form, answers({ email: email.toUpperCase(), legal_business_name: "Second Gym" }), {});
    const [row] = await listApplicants({ q: email });
    expect(row).toMatchObject({ email, applications: 2 });
  });

  it("prefers the filled carrier application as the main PDF", async () => {
    const app = await createApplication(form, answers(), {});
    const summary = await createApplicationPdf(form, app);
    expect((await mainDocument(app.id))?.id).toBe(summary.id);
    const carrier = await createCarrierPdf(app);
    expect((await mainDocument(app.id))?.id).toBe(carrier?.doc.id);
  });

  it("receipt links only work for their own audience", async () => {
    const path = await receiptPath("11111111-2222-3333-4444-555555555555");
    const token = path.replace("/receipt/", "");
    expect(await verify<{ aid: string }>(token, RECEIPT_AUDIENCE)).toMatchObject({ aid: "11111111-2222-3333-4444-555555555555" });
    expect(await verify(token, "ais:session")).toBeNull();
  });
});

describe("OPEN_ACCESS testing switch", () => {
  it("is off unless OPEN_ACCESS=1, and then everyone is staff", async () => {
    vi.stubEnv("OPEN_ACCESS", "1");
    try {
      expect(await getSession()).toMatchObject({ role: "staff" });
    } finally {
      vi.unstubAllEnvs();
    }
    vi.stubEnv("OPEN_ACCESS", "true");
    try {
      // Only the exact value "1" opens it; anything else falls through to cookies (none in tests).
      await expect(getSession()).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
