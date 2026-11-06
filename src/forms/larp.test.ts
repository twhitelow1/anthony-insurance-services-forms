import { describe, expect, it } from "vitest";
import { larpEventApplication as form } from "./larp-event-application";
import { answerSections } from "@/lib/forms/flatten";
import { isInputField, removeRepeatEntry, type FormValues } from "@/lib/forms/types";
import { isVisible, pruneValues, validateSection } from "@/lib/forms/validate";

const section = (id: string) => form.sections.find((s) => s.id === id)!;
const visibleIds = (values: FormValues) =>
  section("additional_insureds").fields.filter((f) => isInputField(f) && isVisible(f, values)).map((f) => f.id);

describe("LARP: Additional Insureds", () => {
  it("shows only #1 until another is added, and is optional", () => {
    expect(visibleIds({})).toEqual(["ai_1_name", "ai_1_street", "ai_1_city", "ai_1_state", "ai_1_zip", "ai_1_relationship", "ai_1_endorsements"]);
    expect(visibleIds({ ai_count: "2" })).toContain("ai_2_street");
    expect(visibleIds({ ai_count: "2" })).not.toContain("ai_3_name");
    expect(validateSection(section("additional_insureds"), {})).toEqual({});
  });

  it("offers the three endorsements, none ticked, with no charge on CG2026", () => {
    const f = section("additional_insureds").fields.find((x) => x.id === "ai_1_endorsements")!;
    expect("options" in f && f.options.map((o) => o.label)).toEqual([
      "Additional Insured Endorsement Page / CG2026",
      "Primary and Non-Contributory – Additional $100",
      "Waiver of Subrogation – Additional $100",
    ]);
  });

  it("removing an entry moves the later ones up", () => {
    const values = { ai_count: "3", ai_1_name: "A", ai_2_name: "B", ai_2_city: "Bville", ai_3_name: "C" };
    const next = { ...values, ...removeRepeatEntry(values, { id: "ai_count", prefix: "ai_", max: 10 }, 2) };
    expect(next).toMatchObject({ ai_count: "2", ai_1_name: "A", ai_2_name: "C", ai_2_city: undefined, ai_3_name: undefined });
  });

  it("puts every entry and endorsement on the application, and drops entries removed", () => {
    const values = pruneValues(form, {
      ai_count: "2",
      ai_1_name: "Parks District",
      ai_1_street: "1 Main St",
      ai_1_endorsements: ["Waiver of Subrogation – Additional $100"],
      ai_2_name: "Castle Venue",
      ai_3_name: "Stale entry",
    });
    const rows = answerSections(form, values).find((s) => s.title === "Additional Insureds")!.rows;
    expect(rows.map((r) => `${r.group}: ${r.label} = ${r.value}`)).toEqual([
      "Additional Insured #1: Full Legal Name = Parks District",
      "Additional Insured #1: Street Address = 1 Main St",
      "Additional Insured #1: Endorsements: select only if required by your venue, landlord, or contract. = Waiver of Subrogation – Additional $100",
      "Additional Insured #2: Full Legal Name = Castle Venue",
    ]);
  });

  it("still shows entries and answers from applications made before this change", () => {
    const old = { ai_1_name: "Old", ai_1_address: "1 Elm St, Town, CO 80000", ai_2_name: "Second", ai_2_email: "v@example.com" };
    expect(visibleIds(old)).toEqual(expect.arrayContaining(["ai_1_address", "ai_2_name", "ai_2_email"]));
    expect(visibleIds(old)).not.toContain("ai_3_name");
  });
});

describe("LARP: Acknowledgments and Signatures", () => {
  it("needs the acknowledgment box ticked", () => {
    const s = section("signature");
    expect(validateSection(s, {}).terms_acknowledged).toBe("This field is required.");
    expect(s.fields.filter((f) => f.type === "content").map((f) => f.title)).toEqual([
      "No payment today",
      "Policy Information",
      "Excluded Activities",
      "Waiver Requirement",
      "Fraud Warning",
      "Applicant’s Acknowledgement",
    ]);
  });
});

describe("LARP: General Liability Questionnaire", () => {
  it("asks whether the insurer is renewing as question 10, answers stacked", () => {
    const s = section("gl_questionnaire");
    const shown = s.fields.filter((f) => isInputField(f) && isVisible(f, {}));
    const q10 = shown.at(-1)!;
    expect(q10).toMatchObject({ id: "insurer_renewing", label: "10. Is your current insurance company renewing your policy this year?", stacked: true, required: true });
    expect("options" in q10 && q10.options.map((o) => o.label)).toEqual(["Yes: they're renewing it", "No: they sent you a letter saying they won't renew"]);
    expect(shown.map((f) => ("label" in f ? f.label.match(/^\d+/)?.[0] : null)).filter(Boolean)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(shown.some((f) => f.id === "insurer_non_renewing")).toBe(false);
    expect(validateSection(s, {}).insurer_renewing).toBe("This field is required.");
    // An application from before still shows its answer to the old question.
    expect(s.fields.some((f) => f.id === "insurer_non_renewing" && isVisible(f, { insurer_non_renewing: "No" }))).toBe(true);
  });
});

describe("LARP: changes from the Oct 29 review", () => {
  const field = (id: string) => form.sections.flatMap((s) => s.fields).find((f) => f.id === id)!;

  it("opens with a short line instead of the instructions box", () => {
    expect(section("policyholder").description).toBe("Please fill out the application below. Once received, a quote will be emailed to you to review.");
    expect(section("policyholder").fields.some((f) => f.type === "content" && f.variant === "info")).toBe(false);
  });

  it("asks the liability aggregate as a dropdown", () => {
    expect(field("gl_aggregate").type).toBe("select");
  });

  it("has Caitlyn's tooltips on the optional coverages, no info box, and none of them required", () => {
    const s = section("optional_coverages");
    expect(s.fields.some((f) => f.type === "content")).toBe(false);
    expect(s.description).toBeUndefined();
    for (const id of ["hired_non_owned_auto", "abuse_molestation", "medical_payment"]) {
      const f = field(id);
      expect(isInputField(f) && f.tooltip).toBeTruthy();
      expect(isInputField(f) && f.required).toBeFalsy();
    }
    expect(validateSection(s, {})).toEqual({});
  });
});
