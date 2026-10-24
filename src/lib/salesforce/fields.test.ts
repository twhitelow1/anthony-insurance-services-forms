import { describe, expect, it } from "vitest";
import type { SalesforceApi } from "./api";
import { accountSelect, visibleFields } from "./fields";

// The integration user can't see Account.Phone or Website (no field-level access): describe leaves them out.
const sf = {
  query: async () => [],
  describe: async (object: string) => ({
    name: object,
    fields: (object === "Account" ? ["Id", "Name", "BillingCity", "OwnerId", "Program__c"] : ["Id", "Email", "LastName"]).map((name) => ({ name, type: "string" })),
  }),
} as unknown as SalesforceApi;

describe("only readable Salesforce fields are queried", () => {
  it("drops fields the user can't see, and keeps Owner.Name when OwnerId is readable", async () => {
    expect(await visibleFields(sf, "Account", ["Name", "Phone", "Website", "BillingCity", "Owner.Name", "Program__c", "Renewal_Status__c"])).toEqual([
      "Name",
      "BillingCity",
      "Owner.Name",
      "Program__c",
    ]);
  });

  it("builds the Account query with its Contacts", async () => {
    expect(await accountSelect(sf)).toBe("SELECT Id, Name, BillingCity, (SELECT Id, Email, LastName FROM Contacts ORDER BY CreatedDate) FROM Account");
  });
});

describe("when the integration user can't read Contacts", () => {
  const noContacts = {
    // Describe can list the relationship, yet the query is refused.
    query: async () => {
      throw new Error("INVALID_TYPE: Didn't understand relationship 'Contacts'");
    },
    describe: async (object: string) => {
      return {
        name: object,
        fields: [{ name: "Id", type: "id" }, { name: "Name", type: "string" }],
        childRelationships: [{ relationshipName: "Contacts", childSObject: "Contact" }],
      };
    },
  } as unknown as SalesforceApi;

  it("leaves the Contacts subquery out, and the access report says what to grant", async () => {
    const { accessReport } = await import("./fields");
    expect(await accountSelect(noContacts)).toBe("SELECT Id, Name FROM Account");
    const report = await accessReport(noContacts);
    expect(report.find((r) => r.object === "Contact")).toMatchObject({ readable: false });
    expect(report.find((r) => r.object === "Account")!.missing).toContain("Phone");
  });
});
