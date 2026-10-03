import { describe, expect, it } from "vitest";
import { sportsFacilityApplication as form } from "@/forms/sports-facility-application";
import { applyOptionOverrides, pruneValues, validateForm } from "@/lib/forms/validate";
import type { FormValues } from "@/lib/forms/types";
import type { GhlCustomField } from "./client";
import { buildContactPayload, ghlOptionOverrides, mappingReport, matchCustomField, normalize } from "./mapping";

const cf = (id: string, name: string, dataType = "TEXT", picklistOptions?: string[]): GhlCustomField => ({
  id,
  name,
  fieldKey: `contact.${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
  dataType,
  picklistOptions,
});

const GHL_FIELDS: GhlCustomField[] = [
  cf("f_eff", "Requested Effective Date", "DATE"),
  cf("f_legal", "Legal Business Name"),
  cf("f_type", "Type Of Business", "SINGLE_OPTIONS", ["Gymnastics", "Cheer", "Dance", "Trampoline Park"]),
  cf("f_loc1", "Street Address - Location #01"),
  cf("f_year", "Business Start Year", "NUMERICAL"),
  cf("f_act1", "Sport / Activity 1"),
  cf("f_act1_u12", "Sport / Activity 1 | 12 & Under", "NUMERICAL"),
  cf("f_transport", "If yes, how?", "CHECKBOX", ["Hired Transportation", "Business Owned Vehicle(s)", "Personal Vehicle(s)"]),
  cf("f_nonrenew", "please describe (Has Applicant ever been non-renewed?)", "LARGE_TEXT"),
  cf("f_retail", "Total Retail Receipts", "MONETORY"),
  cf("f_sig", "Applicants Signature", "SIGNATURE"),
];

describe("matching", () => {
  it("normalizes punctuation, case and spacing", () => {
    expect(normalize("Street Address - Location #01")).toBe("streetaddresslocation01");
    expect(normalize("Business Website:")).toBe(normalize("business website"));
  });

  it("prefers an exact key over the name", () => {
    const fields = [cf("a", "Same Name"), { ...cf("b", "Other"), fieldKey: "contact.special" }];
    expect(matchCustomField({ key: "contact.special", name: "Same Name" }, fields)).toEqual({ field: fields[1] });
    expect(matchCustomField({ key: "special", name: "x" }, fields)).toEqual({ field: fields[1] });
  });

  it("flags ambiguous names instead of guessing", () => {
    const fields = [cf("a", "City"), cf("b", "city:")];
    expect(matchCustomField({ name: "City" }, fields)).toHaveProperty("ambiguous");
  });
});

const baseAnswers: FormValues = {
  requested_effective_date: "2026-11-01",
  first_name: "Jane",
  last_name: "Doe",
  phone: "(555) 123-4567",
  email: "jane@example.com",
  legal_business_name: "Flip Kids LLC",
  location_count: "1",
  location_1_street: "1 Main St",
  business_start_year: "2015",
  non_renewed: "Yes",
  non_renewed_details: "Carrier left the state",
  non_renewed_hidden_junk: "should be dropped",
  activities__rows: "1",
  activities__1__name: "Gymnastics",
  activities__1__u12: "120",
  activities__2__name: "Hidden row (rows=1)",
  transports_participants: "Yes",
  transport_method: ["Hired Transportation", "Personal Vehicle(s)"],
  retail_sales: "Yes",
  retail_receipts: "12,500",
  has_pool: "No",
  pool_depth: "5' or more", // hidden because has_pool = No
  signature: "data:image/png;base64,iVBORw0KGgo=",
};

describe("buildContactPayload", () => {
  const values = pruneValues(form, baseAnswers);
  const { contact, signature, unmapped } = buildContactPayload(form, values, GHL_FIELDS);
  const byId = Object.fromEntries(contact.customFields!.map((c) => [c.id, c.field_value]));

  it("writes standard contact fields", () => {
    expect(contact).toMatchObject({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: "(555) 123-4567",
      companyName: "Flip Kids LLC",
      tags: form.tags,
      source: form.source,
    });
  });

  it("maps custom fields by name, coercing types", () => {
    expect(byId.f_eff).toBe("2026-11-01");
    expect(byId.f_legal).toBe("Flip Kids LLC"); // standard AND custom
    expect(byId.f_loc1).toBe("1 Main St");
    expect(byId.f_year).toBe(2015);
    expect(byId.f_nonrenew).toBe("Carrier left the state");
    expect(byId.f_retail).toBe(12500);
    expect(byId.f_transport).toEqual(["Hired Transportation", "Personal Vehicle(s)"]);
  });

  it("flattens table rows onto numbered GHL fields", () => {
    expect(byId.f_act1).toBe("Gymnastics");
    expect(byId.f_act1_u12).toBe(120);
  });

  it("never sends hidden or unknown answers", () => {
    expect(values).not.toHaveProperty("pool_depth");
    expect(values).not.toHaveProperty("non_renewed_hidden_junk");
    expect(values).not.toHaveProperty("activities__2__name");
  });

  it("routes the signature to the file upload, not customFields", () => {
    expect(signature).toEqual({ fieldId: "f_sig", dataUrl: baseAnswers.signature });
    expect(Object.values(byId)).not.toContain(baseAnswers.signature);
  });

  it("reports answers with no GHL field so the note can carry them", () => {
    expect(unmapped.map((u) => u.label)).toContain("Retail Sales?");
  });
});

describe("GHL-synced dropdown options", () => {
  it("replaces fallback options with the GHL picklist", () => {
    const overrides = ghlOptionOverrides(form, GHL_FIELDS);
    expect(overrides.business_type.map((o) => o.value)).toContain("Trampoline Park");
    const synced = applyOptionOverrides(form, overrides);
    const errs = validateForm(synced, { business_type: "Trampoline Park" });
    expect(errs.business_type).toBeUndefined();
    expect(validateForm(synced, { business_type: "Not an option" }).business_type).toBeDefined();
  });
});

describe("validation", () => {
  it("requires conditional fields only when visible", () => {
    expect(validateForm(form, { non_renewed: "No" }).non_renewed_details).toBeUndefined();
    expect(validateForm(form, { non_renewed: "Yes" }).non_renewed_details).toBeDefined();
    expect(validateForm(form, { location_count: "2" }).location_2_street).toBeDefined();
    expect(validateForm(form, { location_count: "1" }).location_2_street).toBeUndefined();
  });

  it("asks about contract requirement only above $1M", () => {
    expect(validateForm(form, { occurrence_limit: "$1,000,000" }).occurrence_contract_requirement).toBeUndefined();
    expect(validateForm(form, { occurrence_limit: "$2,000,000" }).occurrence_contract_requirement).toBeDefined();
  });

  it("limits primary location choices to the locations entered", () => {
    expect(validateForm(form, { location_count: "2", primary_location: "Location #03" }).primary_location).toBeDefined();
    expect(validateForm(form, { location_count: "3", primary_location: "Location #03" }).primary_location).toBeUndefined();
  });
});

describe("mappingReport", () => {
  it("summarizes matches and gaps", () => {
    const r = mappingReport(form, GHL_FIELDS);
    expect(r.summary.ok).toBeGreaterThan(5);
    expect(r.problems.some((p) => p.label === "Retail Sales?")).toBe(true);
    expect(r.unusedGhlFields).toHaveLength(0);
  });
});

describe("submissionNote", () => {
  it("labels repeated fields with their subheading", async () => {
    const { submissionNote } = await import("./mapping");
    const note = submissionNote(form, { location_count: "2", location_1_street: "1 Main", location_2_street: "2 Oak" }, {});
    expect(note).toContain("[Location #01]\nStreet Address: 1 Main");
    expect(note).toContain("[Location #02]\nStreet Address: 2 Oak");
    expect(note).not.toContain("[Location #03]");
  });
});
