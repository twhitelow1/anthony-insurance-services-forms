import { describe, expect, it } from "vitest";
import { buildUrl, linksFor, URL_PATTERNS } from "./urls";

const bases = {
  salesforce: "https://dg0000000i7rimaa.lightning.force.com/",
  ghl: "https://app.leadalchemist.example",
  ghlLocationId: "LOC123",
  app: "https://forms.example.com",
};

describe("URL builders", () => {
  const l = linksFor(bases);

  it("renders every pattern", () => {
    expect(l.salesforce("Account", "001AAA")).toBe("https://dg0000000i7rimaa.lightning.force.com/lightning/r/Account/001AAA/view");
    expect(l.salesforce("Contact", "003BBB")).toBe("https://dg0000000i7rimaa.lightning.force.com/lightning/r/Contact/003BBB/view");
    expect(l.salesforce("Opportunity", "006CCC")).toBe("https://dg0000000i7rimaa.lightning.force.com/lightning/r/Opportunity/006CCC/view");
    expect(l.ghlContact("c1")).toBe("https://app.leadalchemist.example/v2/location/LOC123/contacts/detail/c1");
    expect(l.ghlOpportunity("o1")).toBe("https://app.leadalchemist.example/v2/location/LOC123/opportunities/list/o1?tab=OpportunityDetails");
    expect(l.ghlCompany("b1")).toBe("https://app.leadalchemist.example/v2/location/LOC123/contacts/smart_list/All");
    expect(l.ghlCompany(null)).toBeNull();
    expect(l.appClient("5f2b")).toBe("https://forms.example.com/admin/clients/5f2b");
    expect(l.appApplication("9a1c")).toBe("https://forms.example.com/admin/applications/9a1c");
    // Every pattern is covered above.
    expect(Object.keys(URL_PATTERNS)).toHaveLength(6);
  });

  it("returns null instead of a broken link when an ID or base is missing", () => {
    expect(l.salesforce("Account", null)).toBeNull();
    expect(linksFor({ ...bases, salesforce: null }).salesforce("Account", "001")).toBeNull();
    expect(linksFor({ ...bases, ghlLocationId: "" }).ghlContact("c1")).toBeNull();
  });

  it("encodes IDs so they can't change the path", () => {
    expect(buildUrl("appClient", { app: "https://x.test", id: "../a b" })).toBe("https://x.test/admin/clients/..%2Fa%20b");
  });
});
