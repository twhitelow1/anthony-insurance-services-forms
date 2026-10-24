import type { SalesforceApi } from "./api";

/**
 * The fields the integration user can actually read. Salesforce reports a field the user has no
 * field-level access to as "No such column", so every query asks only for fields that describe
 * returns (describe lists only accessible fields). "Owner.Name"-style paths are kept when their
 * lookup field (OwnerId) is readable.
 */
export async function visibleFields(sf: SalesforceApi, object: string, wanted: string[]): Promise<string[]> {
  const have = new Set((await sf.describe(object)).fields.map((f) => f.name.toLowerCase()));
  return wanted.filter((f) => {
    const [head] = f.split(".");
    return f.includes(".") ? have.has(`${head}id`.toLowerCase()) : have.has(f.toLowerCase());
  });
}

/** "a, b, c" of the readable fields, always starting with Id. */
export async function selectList(sf: SalesforceApi, object: string, wanted: string[]): Promise<string> {
  const fields = await visibleFields(sf, object, wanted.filter((f) => f !== "Id"));
  return ["Id", ...fields].join(", ");
}

/** The Account and Contact fields the Salesforce screens and imports read. */
export const ACCOUNT_FIELDS = ["Name", "Phone", "Website", "BillingStreet", "BillingCity", "BillingState", "BillingPostalCode", "LastModifiedDate"];
export const CONTACT_FIELDS = ["Email", "FirstName", "LastName", "Phone", "MobilePhone", "Title"];

/** SELECT … (Contacts subquery) FROM Account, with only readable fields. Append WHERE/ORDER/LIMIT. */
export async function accountSelect(sf: SalesforceApi, extra: string[] = []): Promise<string> {
  const [account, contact] = await Promise.all([selectList(sf, "Account", [...ACCOUNT_FIELDS, ...extra]), selectList(sf, "Contact", CONTACT_FIELDS)]);
  return `SELECT ${account}, (SELECT ${contact} FROM Contacts ORDER BY CreatedDate) FROM Account`;
}
