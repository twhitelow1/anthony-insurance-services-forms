import { readFileSync } from "node:fs";
import { PDFCheckBox, PDFDocument, PDFTextField } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sportsFacilityApplication as form } from "@/forms/sports-facility-application";
import { createApplication } from "@/lib/applications/repo";
import { createCarrierPdf, mainDocument } from "@/lib/applications/documents";
import { tableCellId, tableRowCountId, type FormValues } from "@/lib/forms/types";
import { pruneValues } from "@/lib/forms/validate";
import { buildCarrierPdf, carrierFormFor, mapAnswers, templatePath } from ".";

const spec = carrierFormFor(form.slug)!;

// A 1×1 PNG stands in for the drawn signature.
const SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Every branch "Yes" so every field the mapping knows about gets used. */
function fullAnswers(): FormValues {
  const v: FormValues = {
    requested_effective_date: "2026-11-01",
    first_name: "Dana",
    last_name: "Ruiz",
    phone: "(555) 010-2000",
    email: "dana@flipzone.example",
    website: "flipzone.example",
    mailing_address: "100 Main St",
    mailing_city: "Austin",
    mailing_state: "TX",
    mailing_postal_code: "78701",
    mailing_same_as_physical: "No",
    location_count: "3",
    primary_location: "Location #02",
    location_1_street: "1 First St", location_1_city: "Austin", location_1_state: "TX", location_1_zip: "78701",
    location_2_street: "2 Second St", location_2_city: "Round Rock", location_2_state: "TX", location_2_zip: "78664",
    location_3_street: "3 Third St", location_3_city: "Cedar Park", location_3_state: "TX", location_3_zip: "78613",
    legal_business_name: "Flip Zone LLC",
    dba: "Flip Zone",
    business_entity: "LLC",
    business_type: "Gymnastics",
    business_start_year: "2015",
    business_description: "Recreational and competitive gymnastics for ages 3-18. ".repeat(4),
    non_renewed: "Yes",
    non_renewed_details: "Prior carrier left the state.",
    occurrence_limit: "$2,000,000",
    occurrence_contract_requirement: "Yes",
    products_completed_ops_limit: "$2,000,000",
    general_aggregate_limit: "$4,000,000",
    damage_to_premises_limit: "$300,000",
    medical_payment_max: "$5,000",
    sexual_abuse_limit: "$100,000 / $300,000",
    hnoa: "Yes",
    commercial_auto_in_force: "No",
    verify_personal_auto: "No",
    review_mvrs: "Yes",
    agree_going_forward: "Yes",
    employees_drive: "4",
    volunteers_drive: "2",
    hired_vehicle_cost: "$5,000",
    professional_liability: "Yes",
    professional_occurrence_limit: "$2,000,000",
    employee_benefits: "Yes",
    number_of_employees: "25",
    liquor_liability: "Yes",
    liquor_receipts: "$12,000",
    crisis_response: "$50K",
    dental: "Yes",
    accident_medical_expense: "$50K",
    deductible: "$250",
    transports_participants: "Yes",
    transport_method: ["Hired Transportation", "Personal Vehicle(s)"],
    retail_sales: "Yes",
    retail_receipts: "$8,000",
    birthday_parties: "40",
    batting_cages: "0",
    booster_clubs: "1",
    inflatables: "N/A",
    tanning_units: "0",
    has_pool: "Yes",
    pool_depth: "4' or less",
    has_climbing_walls: "Yes",
    climbing_wall_count: "2",
    climbing_wall_height: "18",
    climbing_instructor_quals: "USA Climbing certified",
    aerial_offerings: ["Ropes", "Aerial Silks"],
    ropes_count: "3", ropes_height: "15", silks_count: "2", silks_height: "20",
    aerial_instructor_quals: "5 years circus arts",
    has_trampolines: "Yes",
    trampoline_count: "6",
    ai_landlord_name: "Main St Properties",
    ai_landlord_address: "9 Market St",
    ai_landlord_city: "Austin",
    ai_landlord_state: "TX",
    ai_landlord_zip: "78702",
    [tableRowCountId("activities")]: "2",
    [tableCellId("activities", 1, "name")]: "Gymnastics",
    [tableCellId("activities", 1, "u12")]: "300",
    [tableCellId("activities", 1, "coaches")]: "12",
    [tableCellId("activities", 2, "name")]: "Cheer",
    [tableCellId("activities", 2, "a13_15")]: "80",
    [tableRowCountId("camps")]: "1",
    [tableCellId("camps", 1, "name")]: "Summer camp",
    [tableCellId("camps", 1, "days")]: "20",
    signature: SIGNATURE,
  };
  for (const s of form.sections)
    for (const f of s.fields)
      if (f.type === "radio" && f.options.some((o) => o.value === "Yes") && !(f.id in v)) v[f.id] = "Yes";
  return v;
}

describe("carrier PDF mapping (SFIC-STL-APP-001)", () => {
  it("only uses field names the template has, with the right field types", async () => {
    const pdf = await PDFDocument.load(readFileSync(templatePath(spec.template)));
    const fields = new Map(pdf.getForm().getFields().map((f) => [f.getName(), f]));
    const fill = mapAnswers(spec, pruneValues(form, fullAnswers()));
    const wrong = [
      ...[...fill.text.keys()].filter((n) => !(fields.get(n) instanceof PDFTextField)),
      ...[...fill.checked].filter((n) => !(fields.get(n) instanceof PDFCheckBox)),
    ];
    expect(wrong).toEqual([]);
    expect(fill.text.size + fill.checked.size).toBeGreaterThan(120);
  });

  it("ticks the boxes and fills the text the answers call for", () => {
    const fill = mapAnswers(spec, pruneValues(form, fullAnswers()));
    const text = (n: string) => fill.text.get(n)?.value;
    expect(text("Applicant_Name:_1")).toBe("Flip Zone LLC DBA Flip Zone");
    // Primary location (#02) goes first, #01 second, #03 on the addendum.
    expect(text("Address:_35")).toBe("2 Second St");
    expect(text("Address:_40")).toBe("1 First St");
    expect(fill.addendum.map((a) => a.label)).toContain("Additional location (Location #03)");
    expect(text("g0c0_44")).toBe("Gymnastics");
    expect(text("g0c5_49")).toBe("12");
    expect(text("g1c2_52")).toBe("80");
    expect(text("g0c1_75")).toBe("20");
    for (const box of [
      "No_10", "LLC_11", "Yes_28", "Yes_32", "$2M_97", "Yes_101", "$2M_104", "$4M_106", "$300K_108", "$5K_111",
      "$100K_$300K_118", "Yes_123", "No_126", "$2M_$2M_137", "$50K_153", "$50K_161", "Excess_163",
      "$250_167", "Hired_transportation_212", "Personal_vehicle(s)_214", "4'_or_less_227",
    ])
      expect(fill.checked, box).toContain(box);
    expect(fill.checked).not.toContain("Business_owned_vehicle(s)_213");
    expect(text("Estimated_cost_to_lease_h_135")).toBe("5,000");
    expect(text("#_Zip_Lines:_260")).toBe("0");
    expect(text("#_Ropes:_262")).toBe("3");
    expect(text("Print_Name:_294")).toBe("Dana Ruiz");
    expect(fill.addendum).toContainEqual({ label: "Requested effective date", value: "11/01/2026" });
  });

  it("puts answers this PDF has no box for on the addendum instead of dropping them", () => {
    const fill = mapAnswers(
      spec,
      pruneValues(form, {
        ...fullAnswers(),
        medical_payment_max: "$1,000",
        professional_liability: "No",
        has_pool: "No",
        business_entity: "Corporation",
      }),
    );
    expect(fill.addendum).toContainEqual({ label: "Form of business", value: "Corporation" });
    expect(fill.addendum).toContainEqual({ label: "Medical payments limit", value: "$1,000" });
    expect(fill.checked).toContain("N_A_141");
    expect(fill.text.get("Number_of_Swimming_Pools:_226")?.value).toBe("0");
  });

  it("leaves DBA off when the applicant wrote N/A", () => {
    const fill = mapAnswers(spec, pruneValues(form, { ...fullAnswers(), dba: "N/A" }));
    expect(fill.text.get("Applicant_Name:_1")?.value).toBe("Flip Zone LLC");
  });

  it("fills the real template, signs and dates it, and adds the addendum page", async () => {
    const app = await createApplication(form, pruneValues(form, fullAnswers()), {});
    const { bytes, unknownFields, addendumCount } = await buildCarrierPdf(spec, app);
    expect(unknownFields).toEqual([]);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(6);
    const f = pdf.getForm();
    expect(f.getTextField("Email_Address:_2").getText()).toBe("dana@flipzone.example");
    expect(f.getCheckBox("$2M_97").isChecked()).toBe(true);
    expect(f.getCheckBox("$1M_95").isChecked()).toBe(false);
    // Too long for its box: the field points to the addendum, which has the full text.
    expect(f.getTextField("Business_Description:_19").getText()).toBe("See addendum");
    expect(addendumCount).toBeGreaterThanOrEqual(4);
    // CARRIER_PDF_OUT=/tmp/filled.pdf npx vitest run src/lib/pdf/carrier — to look at the result.
    if (process.env.CARRIER_PDF_OUT) (await import("node:fs")).writeFileSync(process.env.CARRIER_PDF_OUT, bytes);
  });

  it("marks skipped questions No / N/A on the PDF, but leaves the exceptions blank", async () => {
    const app = await createApplication(
      form,
      pruneValues(form, {
        ...fullAnswers(),
        has_trampolines: "No",
        has_pool: "No",
        has_climbing_walls: "No",
        aerial_offerings: [],
        hnoa: "No",
        liquor_liability: "No",
      }),
      {},
    );
    const { bytes, defaulted } = await buildCarrierPdf(spec, app);
    const f = (await PDFDocument.load(bytes)).getForm();
    const checked = (n: string) => f.getCheckBox(n).isChecked();
    const text = (n: string) => f.getTextField(n).getText();

    // Trampoline follow-ups the applicant never saw: No, not blank.
    expect(checked("No_281") && !checked("Yes_280")).toBe(true);
    expect(checked("No_283") && !checked("Yes_282")).toBe(true);
    // Pool, climbing and auto follow-ups too.
    expect(checked("No_242")).toBe(true); // diving board
    expect(checked("No_250")).toBe(true); // climbing walls installed by a rigger
    expect(checked("No_126")).toBe(true); // commercial auto in force
    // Text boxes behind a "No": N/A (counts were already 0).
    expect(text("Height_(ft):_248")).toBe("N/A");
    expect(text("Climbing_wall_instructor__253")).toBe("N/A");
    expect(text("Number_of_Trampolines:_279")).toBe("0");
    expect(text("Name:_289")).toBe("N/A"); // second additional insured, not given
    // Answered questions keep their answers.
    expect(checked("Yes_20") && !checked("No_21")).toBe(true);
    // Exceptions stay blank.
    expect(checked("Yes_131") || checked("No_132")).toBe(false);
    expect(text("Title:_295") ?? "").toBe("");
    expect(text("g4c0_68") ?? "").toBe(""); // empty participant row
    expect(defaulted.no).toBeGreaterThan(10);
  });

  it("stores it as the application's main document", async () => {
    const app = await createApplication(form, pruneValues(form, fullAnswers()), {});
    const result = await createCarrierPdf(app);
    expect(result?.doc.kind).toBe("carrier_form");
    expect(result?.doc.filename).toMatch(/carrier application\.pdf$/);
    expect((await mainDocument(app.id))?.id).toBe(result?.doc.id);
  });
});
