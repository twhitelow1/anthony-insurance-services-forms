import { describe, expect, it } from "vitest";
import { aerialInstructorApplication as form } from "@/forms/aerial-instructor-application";
import { createApplication } from "./repo";
import { listDocuments } from "./documents";
import { attachUploads, checkUpload, saveUpload, uploadRef } from "./uploads";
import { missingUploads, validateSection } from "@/lib/forms/validate";
import { answerSections } from "@/lib/forms/flatten";

const waiver = form.sections.find((s) => s.id === "waiver")!;

describe("applicant uploads (waivers)", () => {
  it("accepts documents and images up to 4 MB, nothing else", () => {
    expect(checkUpload("Waiver.pdf", 1000)).toEqual({ filename: "Waiver.pdf", contentType: "application/pdf" });
    expect(checkUpload("photo.JPG", 1000)).toMatchObject({ contentType: "image/jpeg" });
    expect(checkUpload("evil.html", 1000)).toHaveProperty("error");
    expect(checkUpload("big.pdf", 5 * 1024 * 1024)).toHaveProperty("error");
    expect(checkUpload("a|b.pdf", 10)).toMatchObject({ filename: "a_b.pdf" });
  });

  it("attaches the uploaded waivers to the application on submit", async () => {
    const up = await saveUpload({ formSlug: form.slug, fieldId: "waiver_files", filename: "waiver.pdf", contentType: "application/pdf", content: new TextEncoder().encode("%PDF-1.4 test") });
    const other = await saveUpload({ formSlug: "larp-event-application", fieldId: "waiver_files", filename: "x.pdf", contentType: "application/pdf", content: new Uint8Array([1]) });
    const app = await createApplication(
      form,
      { email: "inst@example.com", first_name: "Ava", waiver_files: [uploadRef(up.id, up.filename), uploadRef(other.id, other.filename)] },
      {},
    );
    expect(await attachUploads(form, app)).toBe(1); // the other form's upload isn't taken
    const docs = await listDocuments(app.id);
    expect(docs.filter((d) => d.kind === "applicant_upload").map((d) => d.filename)).toEqual(["waiver.pdf"]);
    expect(await attachUploads(form, app)).toBe(0); // only once
    expect(answerSections(form, app.values).flatMap((s) => s.rows).find((r) => r.label === "Upload your waiver(s)")?.value).toContain("waiver.pdf");
  });

  it("is optional, but a missing waiver is flagged for the popup and the confirmation email", () => {
    expect(validateSection(waiver, { waiver_agree: "Yes" }).waiver_files).toBeUndefined();
    expect(missingUploads(form, { waiver_agree: "Yes" }).map((n) => n.title)).toEqual(["A signed waiver is required before coverage starts"]);
    expect(missingUploads(form, { waiver_files: ["11111111-1111-1111-1111-111111111111|w.pdf"] })).toEqual([]);
    expect(validateSection(waiver, { waiver_agree: "Yes", waiver_files: ["not-a-ref"] }).waiver_files).toMatch(/didn't upload/);
  });
});
