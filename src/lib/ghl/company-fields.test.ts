import { describe, expect, it } from "vitest";
import { matchCompanyFields, toLaValue } from "./company-fields";

const la = (name: string, dataType = "TEXT", extra = {}) => ({ name, fieldKey: `business.${name.toLowerCase().replace(/\W+/g, "_")}`, dataType, ...extra });

describe("matching Company fields to Salesforce Account fields", () => {
  it("matches by label or API name, the owner alias, and DBA / & spellings; leaves standard and unknown fields", () => {
    const { matched, unmatched } = matchCompanyFields(
      [la("Account Owner Alias"), la("Account Type", "SINGLE_OPTIONS"), la("DBA/Trade Name"), la("Business Income & Exp. Limit", "MONETORY"), la("Renewal Status"), la("Inland Marine Policy"), la("Phone", "TEXT", { standard: true }), la("Nothing Like It")],
      [
        { name: "DBA__c", type: "string", label: "DBA" },
        { name: "Business_Income_Exp_Limit__c", type: "currency", label: "Business Income & Exp. Limit" },
        { name: "Renewal_Status__c", type: "picklist", label: "Renewal Status" },
        { name: "Inland_Marine_Policy__c", type: "string" },
        { name: "Phone", type: "phone", label: "Phone" },
        { name: "Type", type: "picklist", label: "Account Type" },
      ],
    );
    expect(matched.map((m) => [m.la.name, m.sf])).toEqual([
      ["Account Owner Alias", "Owner.Alias"],
      ["Account Type", "Type"],
      ["DBA/Trade Name", "DBA__c"],
      ["Business Income & Exp. Limit", "Business_Income_Exp_Limit__c"],
      ["Renewal Status", "Renewal_Status__c"],
      ["Inland Marine Policy", "Inland_Marine_Policy__c"],
    ]);
    expect(unmatched.map((f) => f.name)).toEqual(["Nothing Like It"]);
  });

  it("converts values to what each Lead Alchemist field type takes", () => {
    expect(toLaValue(la("Premium", "MONETORY"), 1250.5)).toEqual({ value: { currency: "default", value: 1250.5 } });
    expect(toLaValue(la("Count", "NUMERICAL"), "1,200")).toEqual({ value: 1200 });
    expect(toLaValue(la("Effective", "DATE"), "2026-05-01")).toEqual({ value: "2026-05-01" });
    expect(toLaValue(la("Coverage", "MULTIPLE_OPTIONS", { options: [{ key: "gl", label: "General Liability" }, { key: "im", label: "Inland Marine" }] }), "General Liability;Inland Marine")).toEqual({ value: ["gl", "im"] });
    expect(toLaValue(la("Status", "SINGLE_OPTIONS", { options: [{ key: "renewed", label: "Renewed" }] }), "Lost")).toEqual({ skip: expect.stringMatching(/isn't one of its options/) });
    expect(toLaValue(la("Name"), "")).toBeNull();
    expect(toLaValue(la("Name"), null)).toBeNull();
  });
});
