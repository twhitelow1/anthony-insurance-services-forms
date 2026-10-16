import { describe, expect, it } from "vitest";
import { aerialInstructorApplication as form } from "./aerial-instructor-application";
import { answerSections } from "@/lib/forms/flatten";
import { type ChoiceField, isInputField } from "@/lib/forms/types";
import { validateSection } from "@/lib/forms/validate";

const field = (id: string) => form.sections.flatMap((s) => s.fields).find((f) => isInputField(f) && f.id === id);
const section = (id: string) => form.sections.find((s) => s.id === id)!;

describe("aerial instructor application (Oct 16 call)", () => {
  it("offers the website's general aggregate choices as a dropdown", () => {
    const f = field("general_aggregate_limit") as ChoiceField;
    expect(f.type).toBe("select");
    expect(f.options.map((o) => o.value)).toEqual(["$1,000,000", "$2,000,000", "$3,000,000", "$4,000,000", "$5,000,000"]);
  });

  it("asks for alcohol details only after Yes", () => {
    const aerial = section("aerial");
    expect(validateSection(aerial, { alcohol: "No" }).alcohol_details).toBeUndefined();
    expect(validateSection(aerial, { alcohol: "Yes" }).alcohol_details).toBe("This field is required.");
  });

  it("asks for additional insureds only after Yes, and still shows older applications' ones", () => {
    const ai = section("additional_insured");
    expect(validateSection(ai, {}).needs_additional_insured).toBe("This field is required.");
    expect(validateSection(ai, { needs_additional_insured: "No" }).ai_1_name).toBeUndefined();
    expect(validateSection(ai, { needs_additional_insured: "Yes" }).ai_1_name).toBe("This field is required.");
    const old = answerSections(form, { ai_1_name: "Sky Studio" }).flatMap((s) => s.rows);
    expect(old.some((r) => r.value === "Sky Studio")).toBe(true);
  });
});
