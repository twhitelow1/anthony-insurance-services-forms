import { describe, expect, it, vi } from "vitest";
import { sportsFacilityApplication as form } from "@/forms/sports-facility-application";
import { answerSections, answersAsText } from "@/lib/forms/flatten";
import { pruneValues, validateForm } from "@/lib/forms/validate";
import type { FormValues } from "@/lib/forms/types";
import { portalCustomFields, standardContactFields, findField } from "@/lib/ghl/sync";
import { consumeMagicLink, requestMagicLink } from "@/lib/auth/magic-link";
import * as mail from "@/lib/mail/graph";
import {
  createApplication,
  getEvents,
  listForEmail,
  newReference,
  searchApplications,
  setStatus,
} from "./repo";

const answers = (over: FormValues = {}): FormValues =>
  pruneValues(form, {
    first_name: "Jane",
    last_name: "Doe",
    email: "Jane@Example.com",
    phone: "(555) 123-4567",
    legal_business_name: "Flip Kids LLC",
    mailing_city: "Austin",
    mailing_state: "TX",
    location_count: "2",
    location_1_street: "1 Main St",
    location_2_street: "9 Oak Ave",
    business_type: "Gymnastics",
    has_trampolines: "Yes",
    trampoline_count: "4",
    has_pool: "No",
    pool_depth: "5' or more", // hidden → must be dropped
    activities__rows: "1",
    activities__1__name: "Tumbling",
    activities__1__u12: "80",
    signature: "data:image/png;base64,iVBORw0KGgo=",
    ...over,
  });

describe("flatten", () => {
  it("lists only visible answers, grouped under their subheadings", () => {
    const sections = answerSections(form, answers());
    const loc = sections.find((s) => s.title === "Location Information")!;
    expect(loc.rows).toContainEqual({ group: "Location #02", label: "Street Address", value: "9 Oak Ave" });
    const text = answersAsText(form, answers());
    expect(text).not.toContain("5' or more");
    expect(text).not.toContain("base64");
    expect(text).toContain("Sport / Activity: Tumbling · 12 & Under: 80");
  });
});

describe("GHL contact-only sync", () => {
  it("copies only standard contact fields", () => {
    expect(standardContactFields(form, answers())).toEqual({
      firstName: "Jane",
      lastName: "Doe",
      email: "Jane@Example.com",
      phone: "(555) 123-4567",
      companyName: "Flip Kids LLC",
      city: "Austin",
      state: "TX",
    });
  });

  it("fills the three portal fields that exist in GHL", () => {
    const ghl = [
      { id: "f1", name: "Application Status", fieldKey: "contact.application_status", dataType: "TEXT" },
      { id: "f2", name: "application link", fieldKey: "contact.app_link", dataType: "TEXT" },
    ];
    expect(findField(ghl, "Application Link")?.id).toBe("f2");
    const fields = portalCustomFields({ id: "abc-123", reference: "AIS-AAAA-BBBB", status: "in_review" }, ghl);
    expect(fields).toEqual([
      { id: "f1", field_value: "In review" },
      { id: "f2", field_value: "https://forms.example.com/admin/applications/abc-123" },
    ]);
  });
});

describe("references", () => {
  it("are readable and unambiguous", () => {
    for (let i = 0; i < 50; i++) expect(newReference()).toMatch(/^AIS-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  });
});

describe("repository (embedded Postgres)", () => {
  it("stores, searches, updates status and scopes to the applicant", async () => {
    const values = answers();
    expect(validateForm(form, values).email).toBeUndefined();
    const app = await createApplication(form, values, { ip: "1.2.3.4" });
    await createApplication(form, answers({ email: "other@example.com", legal_business_name: "Dance Co", has_trampolines: "No" }), {});

    expect(app.applicantEmail).toBe("jane@example.com");
    expect(app.values).not.toHaveProperty("signature");
    expect(app.signature).toMatch(/^data:image\/png/);
    expect(app.values).not.toHaveProperty("pool_depth");

    // Stemmed full-text search over answers: "trampoline" matches the "Trampolines" answer.
    const hits = await searchApplications({ q: "trampoline Austin" });
    expect(hits.map((h) => h.id)).toEqual([app.id]);
    expect((await searchApplications({ q: app.reference.slice(0, 8) })).map((h) => h.id)).toContain(app.id);
    expect((await searchApplications({ q: "dance" })).map((h) => h.businessName)).toEqual(["Dance Co"]);
    expect((await searchApplications({ q: "100%_\\" })).length).toBe(0); // LIKE wildcards are escaped

    const changed = await setStatus(app.id, "info_needed", "staff:amy@anthonyinsuranceservices.com", "Please send loss runs");
    expect(changed?.previous).toBe("received");
    expect((await searchApplications({ status: "info_needed" })).map((h) => h.id)).toEqual([app.id]);

    const clientEvents = await getEvents(app.id, { clientOnly: true });
    expect(clientEvents.map((e) => e.type)).toEqual(["status_changed", "submitted"]);
    expect(clientEvents[0].message).toBe("Please send loss runs");

    const mine = await listForEmail("JANE@example.com ");
    expect(mine.map((a) => a.id)).toEqual([app.id]);
    expect(mine[0]).not.toHaveProperty("values");
  });

  it("magic links: only for known emails, single use, rate limited", async () => {
    const send = vi.spyOn(mail, "sendMail").mockResolvedValue();
    await requestMagicLink("nobody@example.com");
    expect(send).not.toHaveBeenCalled();

    await requestMagicLink("Jane@Example.com");
    expect(send).toHaveBeenCalledTimes(1);
    const url = String(send.mock.calls[0][0].html.match(/https:\/\/forms\.example\.com\/portal\/verify\?token=[\w-]+/)![0]);
    const token = new URL(url).searchParams.get("token")!;

    expect(await consumeMagicLink(token)).toBe("jane@example.com");
    expect(await consumeMagicLink(token)).toBeNull(); // single use
    expect(await consumeMagicLink("x".repeat(43))).toBeNull();

    await requestMagicLink("jane@example.com");
    await requestMagicLink("jane@example.com");
    await requestMagicLink("jane@example.com"); // 4th within 15 min → dropped
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe("encryption tag", () => {
  it("prefixes the subject only when asked", () => {
    expect(mail.subjectFor({ subject: "Application", encrypt: true })).toBe("[encrypt] Application");
    expect(mail.subjectFor({ subject: "Application" })).toBe("Application");
  });
});
