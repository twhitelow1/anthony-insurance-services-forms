import { describe, expect, it } from "vitest";
import { fitnessFacilityApplication as form } from "./fitness-facility-application";
import { answerSections } from "@/lib/forms/flatten";
import { isInputField, removeRepeatEntry } from "@/lib/forms/types";
import { isVisible, pruneValues, validateSection } from "@/lib/forms/validate";

const section = (id: string) => form.sections.find((s) => s.id === id)!;
const field = (id: string) => form.sections.flatMap((s) => s.fields).find((f) => f.id === id)!;
const tooltip = (id: string) => { const f = field(id); return isInputField(f) ? f.tooltip : undefined; };

describe("fitness facility application (quote request)", () => {
  it("has five steps: no premium calculator and no payment step", () => {
    expect(form.sections.map((s) => s.title)).toEqual([
      "Proposed Policyholder Information",
      "General Liability Questionnaire",
      "Participants & Coverage Selections",
      "Additional Insureds",
      "Acknowledgments and Signatures",
    ]);
    const text = JSON.stringify(form.sections.map((s) => [s.description, s.fields.filter((f) => f.type === "content")]));
    for (const gone of ["Minimum Premium is Fully Earned", "Your agent will calculate your premium", "Premiums are fully earned", "Licensed Agent", "has received the initial premium"]) {
      expect(text).not.toContain(gone);
    }
    expect(section("signature").fields.find((f) => f.id === "quote_request")).toBeTruthy();
    // Earlier applications' payment answers still show; new ones never ask.
    expect(isVisible(field("payment_method"), {})).toBe(false);
    expect(isVisible(field("payment_method"), { payment_method: "Check" })).toBe(true);
  });

  it("asks where the studio is: the mailing address, or its own address, plus any more locations", () => {
    const s = section("policyholder");
    const base = { mailing_address: "1 Main St", mailing_city: "Vail", mailing_state: "CO", mailing_postal_code: "81657" };
    // Same as mailing: Location 1 is the mailing address and nothing more is asked.
    const same = pruneValues(form, { ...base, studio_same_as_mailing: "Yes", loc_1_street: "stale" });
    expect(same.loc_1_mailing).toBe("1 Main St, Vail, CO 81657");
    expect(same.loc_1_street).toBeUndefined();
    expect(Object.keys(validateSection(s, { ...base, studio_same_as_mailing: "Yes" }))).not.toContain("loc_1_street");
    // Different: its address is required (Suite/Unit optional).
    const errors = validateSection(s, { ...base, studio_same_as_mailing: "No" });
    expect(Object.keys(errors)).toEqual(expect.arrayContaining(["loc_1_street", "loc_1_city", "loc_1_state", "loc_1_zip"]));
    expect(errors.loc_1_unit).toBeUndefined();
    // More locations, each removable.
    const three = { ...base, studio_same_as_mailing: "Yes", loc_count: "3", loc_2_street: "2 Elm", loc_2_city: "Avon", loc_3_street: "3 Oak" };
    expect(Object.keys(validateSection(s, three))).toEqual(expect.arrayContaining(["loc_2_state", "loc_3_city"]));
    const removed = { ...three, ...removeRepeatEntry(three, { id: "loc_count", prefix: "loc_", max: 10 }, 2) };
    expect(removed).toMatchObject({ loc_count: "2", loc_2_street: "3 Oak", loc_3_street: undefined });
    // All of them go on the application.
    const rows = answerSections(form, pruneValues(form, { ...three, loc_2_state: "CO", loc_2_zip: "81620" }))[0].rows;
    expect(rows.filter((r) => r.group?.startsWith("Location #") || r.label === "Location #1").map((r) => `${r.group ?? ""} ${r.label}=${r.value}`)).toEqual([
      "Studio Physical Location(s) Location #1=1 Main St, Vail, CO 81657",
      "Location #2 Street Address=2 Elm",
      "Location #2 City=Avon",
      "Location #2 State=CO",
      "Location #2 ZIP Code=81620",
      "Location #3 Street Address=3 Oak",
    ]);
  });

  it("asks whether the insurer is renewing, stacked; keeps old answers", () => {
    expect(field("insurer_renewing")).toMatchObject({ label: "Is your current insurance company renewing your policy this year?", stacked: true, required: true });
    expect(isVisible(field("insurer_non_renewing"), {})).toBe(false);
    expect(isVisible(field("insurer_non_renewing"), { insurer_non_renewing: "No" })).toBe(true);
  });

  it("has the new tooltips", () => {
    expect(tooltip("annual_gross_receipts")).toBe("Total income your studio earns before expenses, including memberships, classes, private sessions, workshops, and retail sales.");
    expect(tooltip("hnoa_coverage")).toContain("Twelve- and fifteen-passenger vans are ineligible");
  });

  it("additional insureds: one at first, separate address, no email, three unticked endorsements, optional", () => {
    const s = section("additional_insureds");
    const ids = s.fields.filter((f) => isInputField(f) && isVisible(f, {})).map((f) => f.id);
    expect(ids).toEqual(["ai_1_name", "ai_1_street", "ai_1_city", "ai_1_state", "ai_1_zip", "ai_1_relationship", "ai_1_endorsements", "independent_contractors"]);
    expect(validateSection(s, {})).toEqual({});
    const e = field("ai_1_endorsements");
    expect("options" in e && e.options.map((o) => o.label)).toEqual([
      "Additional Insured Endorsement Page / CG2026",
      "Primary and Non-Contributory – Additional $100",
      "Waiver of Subrogation – Additional $100",
    ]);
  });
});
