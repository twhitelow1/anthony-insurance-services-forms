import { describe, expect, it } from "vitest";
import { sportsFacilityApplication as form } from "@/forms/sports-facility-application";
import { pruneValues, validateForm } from "./validate";

describe("validation", () => {
  it("requires conditional fields only when visible", () => {
    expect(validateForm(form, { non_renewed: "No" }).non_renewed_details).toBeUndefined();
    expect(validateForm(form, { non_renewed: "Yes" }).non_renewed_details).toBeDefined();
    expect(validateForm(form, { location_count: "2" }).location_2_street).toBeDefined();
    expect(validateForm(form, { location_count: "1" }).location_2_street).toBeUndefined();
  });

  it("asks about contract requirement only above $1M", () => {
    expect(validateForm(form, { occurrence_limit: "$1,000,000" }).occurrence_contract_requirement).toBeUndefined();
    expect(validateForm(form, { occurrence_limit: "$2,000,000" }).occurrence_contract_requirement).toBeDefined();
  });

  it("limits primary location choices to the locations entered", () => {
    expect(validateForm(form, { location_count: "2", primary_location: "Location #03" }).primary_location).toBeDefined();
    expect(validateForm(form, { location_count: "3", primary_location: "Location #03" }).primary_location).toBeUndefined();
  });

  it("rejects bad formats and unknown options", () => {
    const e = validateForm(form, { email: "nope", phone: "123", business_type: "Hacker", business_start_year: "1500" });
    expect(e.email && e.phone && e.business_type && e.business_start_year).toBeTruthy();
  });

  it("prunes hidden, unknown, and out-of-range table values", () => {
    const v = pruneValues(form, {
      has_pool: "No",
      pool_depth: "4' or less",
      injected_field: "x",
      activities__rows: "9",
      activities__3__name: "kept (rows clamps to 3)",
      activities__4__name: "dropped",
    });
    expect(v).not.toHaveProperty("pool_depth");
    expect(v).not.toHaveProperty("injected_field");
    expect(v.activities__rows).toBe("3");
    expect(v.activities__3__name).toBeDefined();
    expect(v).not.toHaveProperty("activities__4__name");
  });
});
