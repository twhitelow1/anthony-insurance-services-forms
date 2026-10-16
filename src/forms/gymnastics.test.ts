import { describe, expect, it } from "vitest";
import { boxingGymApplication, gymnasticsApplication, sportsFacilityApplication } from "./sports-facility-application";
import { HNOA_TOOLTIP, SILKS_MAX_HEIGHT_FT } from "./config";
import { answerSections } from "@/lib/forms/flatten";
import { type ChoiceField, type FormDefinition, type InputField, isInputField } from "@/lib/forms/types";
import { pruneValues, triggeredNotices, validateForm, validateSection } from "@/lib/forms/validate";

const field = (form: FormDefinition, id: string) =>
  form.sections.flatMap((s) => s.fields).find((f): f is InputField => isInputField(f) && f.id === id);
const options = (form: FormDefinition, id: string) => (field(form, id) as ChoiceField).options.map((o) => o.value);
const section = (form: FormDefinition, id: string) => form.sections.find((s) => s.id === id)!;

describe("gymnastics liability limits (Oct 9 call)", () => {
  it("doesn't ask for products & completed operations (the PDF gets $1M)", () => {
    expect(field(gymnasticsApplication, "products_completed_ops_limit")).toBeUndefined();
  });

  it("offers the carrier's own choices for aggregate, premises, medical and abuse limits", () => {
    expect(options(gymnasticsApplication, "general_aggregate_limit")).toEqual(["$3,000,000", "$4,000,000", "$5,000,000"]);
    expect(options(gymnasticsApplication, "damage_to_premises_limit")).toEqual(["$300,000", "$500,000", "$1,000,000"]);
    expect(options(gymnasticsApplication, "medical_payment_max")).toEqual(["$5,000", "$10,000"]);
    const abuse = options(gymnasticsApplication, "sexual_abuse_limit");
    expect(abuse).toContain("$1,000,000 / $1,000,000");
    expect(abuse).toContain("$1,000,000 / $2,000,000");
    expect(abuse.some((o) => /n\/?a|none/i.test(o))).toBe(false);
  });

  it("never offers $1.5M occurrence", () => {
    expect(options(gymnasticsApplication, "occurrence_limit")).not.toContain("$1,500,000");
  });

  it("leaves Sports Facility and Boxing Gym as they were", () => {
    for (const form of [sportsFacilityApplication, boxingGymApplication]) {
      expect(field(form, "products_completed_ops_limit")?.type).toBe("text");
      expect(field(form, "general_aggregate_limit")?.type).toBe("text");
      expect(options(form, "medical_payment_max")).toEqual(["$1,000", "$5,000", "$10,000"]);
      expect(options(form, "sexual_abuse_limit")).not.toContain("$1,000,000 / $2,000,000");
      expect(field(form, "aerial_instructor_quals")).toBeDefined();
      expect(field(form, "players_compensated")).not.toHaveProperty("decline.when");
      expect(field(form, "hnoa")?.tooltip).toBeUndefined();
    }
  });

  it("explains hired & non-owned auto with the editable tooltip", () => {
    expect(field(gymnasticsApplication, "hnoa")?.tooltip).toBe(HNOA_TOOLTIP);
  });
});

describe("gymnastics underwriting rules", () => {
  const uw = section(gymnasticsApplication, "underwriting");

  it.each(["players_compensated", "residential_property"])("declines when %s is Yes, and blocks the step", (id) => {
    const errors = validateSection(uw, { [id]: "Yes" });
    expect(errors[id]).toMatch(/can't offer coverage/);
    expect(validateForm(gymnasticsApplication, pruneValues(gymnasticsApplication, { [id]: "Yes" }))[id]).toMatch(/can't offer coverage/);
    // "No" is fine.
    expect(validateSection(uw, { [id]: "No" })[id]).toBeUndefined();
    // The same answer on Sports Facility is still allowed.
    expect(validateSection(section(sportsFacilityApplication, "underwriting"), { [id]: "Yes" })[id]).toBeUndefined();
  });

  it("shows compliance notices for a missing concussion or background-check policy, with sample documents", () => {
    const notices = triggeredNotices(gymnasticsApplication, { concussion_policy: "No", background_checks_policy: "No" });
    expect(notices.map((n) => n.fieldId)).toEqual(["concussion_policy", "background_checks_policy"]);
    expect(notices.every((n) => n.documents?.length)).toBe(true);
    expect(triggeredNotices(gymnasticsApplication, { concussion_policy: "Yes" })).toEqual([]);
    // A notice never blocks.
    expect(validateSection(uw, { concussion_policy: "No" }).concussion_policy).toBeUndefined();
  });

  it(`caps aerial silks at ${SILKS_MAX_HEIGHT_FT} ft with a clear message`, () => {
    const exposures = section(gymnasticsApplication, "exposures");
    const v = { aerial_offerings: ["Aerial Silks"] };
    expect(validateSection(exposures, { ...v, silks_height: String(SILKS_MAX_HEIGHT_FT) }).silks_height).toBeUndefined();
    expect(validateSection(exposures, { ...v, silks_height: String(SILKS_MAX_HEIGHT_FT + 1) }).silks_height).toMatch(
      new RegExp(`${SILKS_MAX_HEIGHT_FT} ft or lower`),
    );
  });

  it("no longer asks for aerial instructor qualifications, and old answers still render", () => {
    expect(field(gymnasticsApplication, "aerial_instructor_quals")).toBeUndefined();
    const old = { aerial_offerings: ["Ropes"], aerial_instructor_quals: "10 years", legal_business_name: "Flip Zone" };
    expect(() => answerSections(gymnasticsApplication, old)).not.toThrow();
    expect(validateSection(section(gymnasticsApplication, "exposures"), old).aerial_instructor_quals).toBeUndefined();
  });
});

describe("staff testing mode", () => {
  it("skips required fields, but still needs an email and still blocks declines", () => {
    const errors = validateForm(gymnasticsApplication, { players_compensated: "Yes" }, { skipRequired: true });
    expect(Object.keys(errors).sort()).toEqual(["email", "players_compensated"]);
    expect(Object.keys(validateForm(gymnasticsApplication, {})).length).toBeGreaterThan(20);
  });
});
