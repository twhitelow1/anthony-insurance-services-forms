import { readFileSync } from "node:fs";
import { PDFCheckBox, PDFDocument, PDFTextField } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { sportsFacilityApplication as form } from "@/forms/sports-facility-application";
import { createApplication } from "@/lib/applications/repo";
import { carrierPdfFor, getCarrierTemplate, removeCarrierTemplate, saveCarrierMapping, saveCarrierTemplate } from "@/lib/applications/carrier-templates";
import { buildUploadedCarrierPdf, labelledPdf, readPdfFields, suggestMapping } from "./uploaded";
import { templatePath } from ".";

const PDF = readFileSync(templatePath("sfic-stl-app-001.pdf"));
const SIGNATURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("an uploaded carrier PDF", () => {
  it("reads the fillable boxes and suggests the obvious matches", async () => {
    const fields = await readPdfFields(PDF);
    expect(fields.length).toBeGreaterThan(100);
    expect(fields.find((f) => f.name === "Yes_9")).toMatchObject({ type: "checkbox", page: 0 });
    const s = suggestMapping(form, fields);
    expect(s["Email_Address:_2"]).toBe("q:email");
    expect(s["Website:_4"]).toBe("q:website");
    // The "box names" copy prints the names on a flattened copy.
    const labelled = await PDFDocument.load(await labelledPdf(PDF));
    expect(labelled.getForm().getFields()).toHaveLength(0);
  });

  it("refuses a PDF with no fillable boxes, or that isn't a PDF", async () => {
    const flat = await PDFDocument.create();
    flat.addPage();
    await expect(saveCarrierTemplate(form.slug, { name: "Flat", filename: "flat.pdf", content: Buffer.from(await flat.save()) }, "staff:t")).rejects.toThrow(/no fillable boxes/);
    await expect(readPdfFields(Buffer.from("not a pdf"))).rejects.toThrow(/couldn't be read/);
  });

  it("fills text, ticks the right boxes, adds the signature and date, and replaces the built-in PDF for that form", async () => {
    const app = await createApplication(form, {
      email: "dana@flipzone.example",
      website: "flipzone.example",
      legal_business_name: "Flip Zone LLC",
      business_structure: "llc",
      signature: SIGNATURE,
    }, {});
    const mapping = {
      "Email_Address:_2": "q:email",
      "Applicant_Name:_1": "business",
      "Website:_4": "q:website",
      LLC_11: "q:business_structure=llc",
      Trust_15: "q:business_structure=trust",
      "Phone:_3": "na",
      "City:_6": "date",
    };
    const out = await buildUploadedCarrierPdf({ name: "Test carrier", content: PDF, mapping, fillBlanks: false }, form, app);
    const filled = (await PDFDocument.load(out.bytes)).getForm();
    const text = (n: string) => (filled.getField(n) as PDFTextField).getText();
    expect(text("Email_Address:_2")).toBe("dana@flipzone.example");
    expect(text("Applicant_Name:_1")).toBe("Flip Zone LLC");
    expect(text("Phone:_3")).toBe("N/A");
    expect(text("City:_6")).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect((filled.getField("LLC_11") as PDFCheckBox).isChecked()).toBe(true);
    expect((filled.getField("Trust_15") as PDFCheckBox).isChecked()).toBe(false);
    expect(text("State:_7") ?? "").toBe("");

    // Saved for the form, it's what applications on that form get from now on.
    await saveCarrierTemplate(form.slug, { name: "Uploaded SFIC", filename: "sfic.pdf", content: PDF }, "staff:t");
    expect((await getCarrierTemplate(form.slug))!.mapping["Email_Address:_2"]).toBe("q:email");
    await saveCarrierMapping(form.slug, mapping, true, null, "staff:t");
    const carrier = (await carrierPdfFor(app))!;
    expect(carrier.name).toBe("Uploaded SFIC");
    const blanks = (await PDFDocument.load((await carrier.build(app)).bytes)).getForm();
    expect((blanks.getField("State:_7") as PDFTextField).getText()).toBe("N/A");
    await removeCarrierTemplate(form.slug);
    expect((await carrierPdfFor(app))!.name).not.toBe("Uploaded SFIC");
  });
});
