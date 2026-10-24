import { describe, expect, it } from "vitest";
import { equipmentFloaterApplication as form } from "./equipment-floater-application";
import { isVisible } from "@/lib/forms/validate";
import type { FormValues } from "@/lib/forms/types";

const ANNUAL = "I need an ANNUAL POLICY";
const field = (id: string) => form.sections.flatMap((s) => s.fields).find((f) => f.id === id)!;
const annual = (extra: FormValues = {}): FormValues => {
  const term = (field("policy_term") as { options: { value: string }[] }).options.find((o) => o.value.startsWith(ANNUAL))!;
  return { policy_term: term.value, ...extra };
};
const shown = (id: string, values: FormValues) => isVisible(field(id), values);

describe("equipment floater: sections from the carrier PDF", () => {
  it("asks about single items of $150K or more", () => {
    expect(shown("single_item_150k", {})).toBe(true);
  });

  it("shows the custom-made items chart only for custom items over $5,000", () => {
    expect(shown("custom_items", annual())).toBe(true);
    expect(shown("custom_items_table", annual({ custom_items: "Yes", custom_items_over_5000: "No" }))).toBe(false);
    expect(shown("custom_items_table", annual({ custom_items: "Yes", custom_items_over_5000: "Yes" }))).toBe(true);
  });

  it("asks the tenant betterments questions only when a tenant improvements value was entered", () => {
    expect(shown("tb_location_address", annual({ tenant_improvements_value: "0" }))).toBe(false);
    expect(shown("tb_location_address", annual({ tenant_improvements_value: "25,000" }))).toBe(true);
    expect(shown("tb_location_address", { tenant_improvements_value: "25,000" })).toBe(false);
  });

  it("schedules trailers with their storage and overnight follow-ups", () => {
    expect(shown("trailers", annual({ has_trailers: "No" }))).toBe(false);
    const withTrailer = annual({ has_trailers: "Yes" });
    expect(shown("trailers", withTrailer)).toBe(true);
    expect(shown("trailer_storage_other", { ...withTrailer, trailer_storage: "Other" })).toBe(true);
    expect(shown("trailer_overnight_parking", { ...withTrailer, trailer_overnight: "Yes" })).toBe(true);
  });

  it("asks about equipment left in vehicles, with parking garage details", () => {
    const leaves = annual({ unattended_in_vehicle: "Yes" });
    expect(shown("unattended_owned_max", annual({ unattended_in_vehicle: "No" }))).toBe(false);
    expect(shown("unattended_owned_max", leaves)).toBe(true);
    expect(shown("parking_garage_features", { ...leaves, vehicle_parking: ["City street"] })).toBe(false);
    expect(shown("parking_garage_features", { ...leaves, vehicle_parking: ["Parking garage"] })).toBe(true);
  });
});
