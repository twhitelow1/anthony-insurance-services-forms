import { readFileSync } from "node:fs";
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFName, PDFRadioGroup, PDFTextField } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { fitnessFacilityApplication as form } from "@/forms/fitness-facility-application";
import { createApplication } from "@/lib/applications/repo";
import { createCarrierPdf, mainDocument } from "@/lib/applications/documents";
import type { FormValues } from "@/lib/forms/types";
import { pruneValues } from "@/lib/forms/validate";
import { buildCarrierPdf, carrierFormFor, mapAnswers, templatePath } from ".";
import { FITNESS_SPORTS, FITNESS_YES_NO } from "./fitness";

const spec = carrierFormFor(form.slug)!;

const SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function fullAnswers(): FormValues {
  const v: FormValues = {
    legal_business_name: "Peak Motion LLC",
    first_name: "Sam",
    last_name: "Ortiz",
    phone: "(555) 010-3000",
    requested_effective_date: "2026-11-01",
    email: "sam@peakmotion.example",
    mailing_address: "20 Elm St",
    mailing_city: "Denver",
    mailing_state: "CO",
    mailing_postal_code: "80202",
    type_of_operation: "Limited Liability Company (LLC)",
    operating_under_dba: "Yes",
    dba: "Peak Yoga",
    claims_paid_3yrs: "Yes",
    claims_description: "Slip in the locker room, $2,400 paid.",
    annual_gross_receipts: "350000",
    sports_trained: ["Yoga", "Pilates", "Barre", "Other"],
    sports_trained_other: "Aerial yoga",
    general_liability_aggregate: "$3,000,000",
    number_of_participants: "1,200",
    hnoa_coverage: "$500,000 for an additional $500.00",
    abuse_molestation_coverage: "$100,000 / $300,000 for an additional $500.00",
    medical_payment: "No, thank you.",
    ai_1_name: "Elm Street Properties",
    ai_1_email: "lease@elm.example",
    ai_1_address: "1 Market St, Denver, CO 80202",
    ai_1_relationship: "L - Landlord",
    ai_1_endorsements: ["Primary Non-Contributory ($100.00)", "Waiver of Subrogation ($100.00)"],
    ai_2_name: "Jo Lee",
    ai_2_address: "5 Pine St, Denver, CO 80203",
    ai_2_relationship: "IC - Independent Contractor (Cost: $75)",
    ai_2_endorsements: ["Waiver of Subrogation ($100.00)"],
    independent_contractors: "2",
    payment_amount: "20% of my total premium",
    payment_method: "Credit Card",
    signature: SIGNATURE,
    signature_date: "2026-10-16",
  };
  for (const s of form.sections)
    for (const f of s.fields)
      if (f.type === "radio" && f.options.some((o) => o.value === "Yes") && !(f.id in v)) v[f.id] = "No";
  return v;
}

const template = async () => PDFDocument.load(readFileSync(templatePath(spec.template)));

describe("carrier PDF mapping (Fitness CTF 2/28/2023)", () => {
  it("maps every Yes/No question on the web form", () => {
    const mapped = new Set(FITNESS_YES_NO.map(([id]) => id));
    const yesNo = form.sections.flatMap((s) => s.fields).filter((f) => f.type === "radio" && f.options.some((o) => o.value === "Yes"));
    // The DBA question has no Yes/No on the PDF: the DBA box is filled or N/A instead.
    expect(yesNo.map((f) => f.id).filter((id) => !mapped.has(id))).toEqual(["operating_under_dba"]);
  });

  it("only uses field names, buttons and options the template has", async () => {
    const pdfForm = (await template()).getForm();
    const fields = new Map(pdfForm.getFields().map((f) => [f.getName(), f]));
    const fill = mapAnswers(spec, pruneValues(form, fullAnswers()));
    const wrong = [
      ...[...fill.text.keys()].filter((n) => !(fields.get(n) instanceof PDFTextField)),
      ...[...fill.checked].filter((n) => !(fields.get(n) instanceof PDFCheckBox)),
      ...[...fill.radios].filter(([n, v]) => {
        const f = fields.get(n);
        return !(f instanceof PDFRadioGroup && f.getOptions().includes(v));
      }),
      ...[...fill.dropdowns].filter(([n, { value }]) => {
        const f = fields.get(n);
        return !(f instanceof PDFDropdown && f.getOptions().includes(value));
      }),
    ];
    expect(wrong).toEqual([]);
    // Every Yes/No group's YES and NO buttons exist, whatever the answers.
    for (const [, group, yes, no] of FITNESS_YES_NO) expect(pdfForm.getRadioGroup(group).getOptions()).toEqual(expect.arrayContaining([yes, no]));
  });

  it("puts each Yes/No on its own row, in page order, with YES on the left", async () => {
    const doc = await template();
    const pdfForm = doc.getForm();
    const pageOf = (ref: unknown) => doc.getPages().findIndex((p) => p.ref === ref);
    const rows = FITNESS_YES_NO.map(([id, group, yes, no]) => {
      const widgets = pdfForm.getRadioGroup(group).acroField.getWidgets();
      const at = (value: string) => {
        const w = widgets.find((w) => w.getOnValue()?.decodeText() === value)!;
        return { ...w.getRectangle(), page: pageOf(w.P()) };
      };
      return { id, yes: at(yes), no: at(no) };
    });
    for (const { id, yes, no } of rows) {
      expect(yes.x, id).toBeLessThan(no.x);
      expect(Math.abs(yes.y - no.y), id).toBeLessThan(3);
    }
    // Down the page: each row is on a later page, or lower on the same page.
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1].yes, rows[i].yes];
      expect(b.page > a.page || (b.page === a.page && b.y < a.y - 10), rows[i].id).toBe(true);
    }
  });

  it("lines the sport checkboxes up with the printed grid", async () => {
    const pdfForm = (await template()).getForm();
    const fill = mapAnswers(spec, pruneValues(form, { ...fullAnswers(), sports_trained: FITNESS_SPORTS.flat() }));
    expect(fill.checked.size).toBe(21 + 3 /* additional insured endorsements */);
    const box = (n: number) => pdfForm.getCheckBox(`Check Box ${n}`).acroField.getWidgets()[0].getRectangle();
    // Boxes are numbered across each row: 1 2 3 / 4 5 6 / …
    for (let n = 1; n <= 21; n++) {
      if (n % 3 !== 1) expect(box(n).x).toBeGreaterThan(box(n - 1).x);
      if (n > 3) expect(box(n).y).toBeLessThan(box(n - 3).y);
    }
  });

  it("fills the boxes the answers call for", () => {
    const fill = mapAnswers(spec, pruneValues(form, fullAnswers()));
    const text = (n: string) => fill.text.get(n)?.value;
    expect(text("Full Legal Name of Proposed Policyholder")).toBe("Peak Motion LLC");
    expect(text("business.Business Name 2")).toBe("Peak Yoga");
    expect(text("Contact Name")).toBe("Sam Ortiz");
    expect(text("Requested Effective Date_af_date")).toBe("11/01/2026");
    expect(text("Annual gross receipt")).toBe("$350,000");
    expect(text("Number of Participants")).toBe("1200");
    expect(text("Claims paid")).toBe("Slip in the locker room, $2,400 paid.");
    expect(text("Other Style 3")).toBe("Aerial yoga");
    expect(text("Other")).toBe("N/A");
    expect(text("Name Email 1")).toBe("Elm Street Properties, lease@elm.example");
    expect(text("Name Email 2")).toBe("Jo Lee");
    expect(text("Primary Number")).toBe("1");
    expect(text("Waiver Number")).toBe("2");
    expect(text("IC Number")).toBe("2");
    expect(text("Date")).toBe("10/16/2026");
    expect(fill.dropdowns.get("State")?.value).toBe("Colorado");
    expect(fill.dropdowns.get("Relationship 1")?.value).toBe("L");
    expect(fill.dropdowns.get("Relationship 2")?.value).toBe("IC (Cost: $75)");
    for (const box of ["Check Box 14" /* Pilates */, "Check Box 4" /* Barre */, "Check Box 12" /* Yoga */, "Check Box 21", "Primary 1", "Waiver 1", "Waiver 2"])
      expect(fill.checked, box).toContain(box);
    expect(fill.checked).not.toContain("Primary 2");
    expect(Object.fromEntries(fill.radios)).toMatchObject({
      "Type of Operation": "Choice4",
      "General Aggregate": "1.10",
      "HNOA Radio": "500",
      "Abuse radio": "500",
      "MedBenefit Radio": "0",
      "Enclosed is?": "20%",
      "Payment Method": "1",
      "Claims during 3 years?": "Choice1",
      "WeightsOver50lb?": "false",
      "Incident reports?": "Choice2", // the playground-equipment row
    });
    expect(fill.addendum).toEqual([]);
  });

  it("writes N/A where a No hid the follow-up", () => {
    const fill = mapAnswers(
      spec,
      pruneValues(form, { ...fullAnswers(), operating_under_dba: "No", claims_paid_3yrs: "No", sports_trained: ["Yoga"] }),
    );
    expect(fill.text.get("business.Business Name 2")?.value).toBe("N/A");
    expect(fill.text.get("Claims paid")?.value).toBe("N/A");
    expect(fill.text.get("Other Style 3")?.value).toBe("N/A");
  });

  it("adds the addendum page only when an answer has no box", async () => {
    const values = { ...pruneValues(form, fullAnswers()), general_liability_aggregate: "$6,000,000" };
    const app = await createApplication(form, pruneValues(form, fullAnswers()), {});
    const { bytes, addendumCount } = await buildCarrierPdf(spec, { ...app, values });
    expect(addendumCount).toBe(1);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(5);
  });

  it("puts an answer with no matching box on the addendum", () => {
    const fill = mapAnswers(spec, { ...pruneValues(form, fullAnswers()), general_liability_aggregate: "$6,000,000", mailing_state: "PR" });
    expect(fill.addendum).toContainEqual({ label: "General liability aggregate", value: "$6,000,000" });
    expect(fill.addendum).toContainEqual({ label: "Mailing state", value: "PR" });
    expect(fill.radios.has("General Aggregate")).toBe(false);
  });

  it("fills the real template, four pages like the blank, with the premium and card boxes left alone", async () => {
    const app = await createApplication(form, pruneValues(form, fullAnswers()), {});
    const { bytes, unknownFields, addendumCount, defaulted } = await buildCarrierPdf(spec, app);
    expect(unknownFields).toEqual([]);
    expect(defaulted).toEqual({ no: 0, na: 0 });
    expect(addendumCount).toBe(0);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(4);
    const f = pdf.getForm();
    expect(f.getTextField("Email Address").getText()).toBe("sam@peakmotion.example");
    // Too wide at the template's 11pt: shrunk to fit rather than cut off.
    expect(f.getTextField("Name Email 1").getText()).toBe("Elm Street Properties, lease@elm.example");
    // The template's blank signature box is see-through, so the drawn signature shows.
    expect(f.getSignature("Proposed Policyholder").acroField.getWidgets()[0].dict.get(PDFName.of("AP"))).toBeUndefined();
    expect(f.getSignature("Licensed Agent").acroField.getWidgets()[0].dict.get(PDFName.of("AP"))).toBeDefined();
    expect(f.getRadioGroup("General Aggregate").getSelected()).toBe("1.10");
    expect(f.getRadioGroup("Criminal background checks?").getSelected()).toBe("Choice2"); // safety training: No
    expect(f.getCheckBox("Check Box 12").isChecked()).toBe(true);
    expect(f.getCheckBox("Check Box 1").isChecked()).toBe(false);
    expect(f.getTextField("cc.Card Number").getText() ?? "").toBe("");
    expect(f.getTextField("Licensed Agent Name").getText() ?? "").toBe("");
    expect(f.getTextField("Agency Name").getText()).toBe("Anthony Insurance Services, Inc.");
    // Dropdowns store the export value Acrobat's calculations read, and the option's index.
    const state = f.getDropdown("State").acroField.dict;
    expect(state.get(PDFName.of("V"))?.toString()).toBe("(0)");
    expect(state.get(PDFName.of("I"))?.toString()).toBe(`[ ${f.getDropdown("State").getOptions().indexOf("Colorado")} ]`);
    expect(f.getDropdown("Relationship 2").acroField.dict.get(PDFName.of("V"))?.toString()).toBe("(1)");
    // Looks like the template: ticks and radio buttons keep its own drawings, text uses its Roboto.
    const blank = (await template()).getForm();
    const ap = (form: typeof f, name: string) => form.getField(name).acroField.getWidgets()[0].dict.get(PDFName.of("AP"))?.toString();
    for (const name of ["Check Box 12", "Primary 1", "General Aggregate", "Payment Method"]) expect(ap(f, name), name).toBe(ap(blank, name));
    const fontsUsed = f.getTextField("Name Email 1").acroField.getWidgets()[0].getNormalAppearance();
    expect(pdf.context.lookup(fontsUsed)?.toString() ?? "").toMatch(/Roboto/);
    // CARRIER_PDF_OUT=/tmp/fitness.pdf npx vitest run src/lib/pdf/carrier/fitness — to look at the result.
    if (process.env.CARRIER_PDF_OUT) (await import("node:fs")).writeFileSync(process.env.CARRIER_PDF_OUT, bytes);
  });

  it("stores it as the application's main document", async () => {
    const app = await createApplication(form, pruneValues(form, fullAnswers()), {});
    const result = await createCarrierPdf(app);
    expect(result?.doc.kind).toBe("carrier_form");
    expect((await mainDocument(app.id))?.id).toBe(result?.doc.id);
  });
});
