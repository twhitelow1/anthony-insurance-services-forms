import { describe, expect, it } from "vitest";
import { aerialDanceStudioApplication, aerialYogaStudioApplication } from "./aerial-studio-application";
import { isInputField } from "@/lib/forms/types";
import { missingUploads, validateSection } from "@/lib/forms/validate";

describe.each([aerialYogaStudioApplication, aerialDanceStudioApplication])("$slug", (form) => {
  const field = (id: string) => form.sections.flatMap((s) => s.fields).find((f) => isInputField(f) && f.id === id);

  it("asks about alcohol / BYOB as Yes or No", () => {
    expect(field("alcohol_on_site")?.type).toBe("radio");
    const section = form.sections.find((s) => s.fields.some((f) => f.id === "alcohol_on_site"))!;
    expect(validateSection(section, {}).alcohol_on_site).toBe("This field is required.");
    expect(validateSection(section, { alcohol_on_site: "Maybe" }).alcohol_on_site).toBe("Choose one of the options.");
  });

  it("takes the waiver as an upload, with the reminder when it's missing", () => {
    expect(field("waiver_files")?.type).toBe("file");
    expect(missingUploads(form, {}).map((n) => n.title)).toEqual(["A signed waiver is required before coverage starts"]);
  });
});
