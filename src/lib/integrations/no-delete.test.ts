import { describe, expect, it } from "vitest";
import { assertLeadAlchemistRequestAllowed, assertSalesforceRequestAllowed, DeleteNotAllowedError } from "./no-delete";

describe("no deletes in Salesforce or Lead Alchemist", () => {
  it("allows reads, creates and updates in Salesforce", () => {
    expect(() => assertSalesforceRequestAllowed(undefined, "/query?q=SELECT+Id+FROM+Account")).not.toThrow();
    expect(() => assertSalesforceRequestAllowed("POST", "/sobjects/Account")).not.toThrow();
    expect(() => assertSalesforceRequestAllowed("PATCH", "/sobjects/Account/001xx")).not.toThrow();
  });

  it("blocks Salesforce deletes, including ones bundled in composite or bulk calls", () => {
    expect(() => assertSalesforceRequestAllowed("DELETE", "/sobjects/Account/001xx")).toThrow(DeleteNotAllowedError);
    expect(() => assertSalesforceRequestAllowed("delete", "/sobjects/Contact/003xx")).toThrow(DeleteNotAllowedError);
    expect(() => assertSalesforceRequestAllowed("POST", "/composite/sobjects")).toThrow(DeleteNotAllowedError);
    expect(() => assertSalesforceRequestAllowed("POST", "/jobs/ingest")).toThrow(DeleteNotAllowedError);
  });

  it("allows Lead Alchemist reads, creates, updates and status-tag removal", () => {
    expect(() => assertLeadAlchemistRequestAllowed("POST", "/contacts/upsert")).not.toThrow();
    expect(() => assertLeadAlchemistRequestAllowed("PUT", "/businesses/b1")).not.toThrow();
    expect(() => assertLeadAlchemistRequestAllowed("DELETE", "/contacts/c1/tags")).not.toThrow();
  });

  it("blocks Lead Alchemist record deletes", () => {
    expect(() => assertLeadAlchemistRequestAllowed("DELETE", "/contacts/c1")).toThrow(DeleteNotAllowedError);
    expect(() => assertLeadAlchemistRequestAllowed("DELETE", "/businesses/b1")).toThrow(DeleteNotAllowedError);
    expect(() => assertLeadAlchemistRequestAllowed("DELETE", "/opportunities/o1")).toThrow(DeleteNotAllowedError);
    expect(() => assertLeadAlchemistRequestAllowed("DELETE", "/contacts/c1/notes/n1")).toThrow(DeleteNotAllowedError);
    expect(() => assertLeadAlchemistRequestAllowed("POST", "/contacts/bulk/delete")).toThrow(DeleteNotAllowedError);
  });
});
