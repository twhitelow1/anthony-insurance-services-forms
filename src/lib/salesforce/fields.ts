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

/**
 * Whether the integration user can read Contacts under an Account. Without Read on the Contact
 * object Salesforce rejects the Account → Contacts subquery ("Didn't understand relationship"),
 * even when describe lists it, so this asks with a one-row test query. Remembered for 5 minutes.
 */
const contactsProbe = new WeakMap<SalesforceApi, { at: number; value: Promise<boolean> }>();
export function contactsReadable(sf: SalesforceApi): Promise<boolean> {
  const hit = contactsProbe.get(sf);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  const value = sf
    .query("SELECT Id, (SELECT Id FROM Contacts LIMIT 1) FROM Account LIMIT 1", { max: 1 })
    .then(() => true)
    .catch((err: unknown) => {
      console.warn("[salesforce] Contacts aren't readable by the integration user:", err instanceof Error ? err.message.slice(0, 160) : err);
      return false;
    });
  contactsProbe.set(sf, { at: Date.now(), value });
  return value;
}

/** SELECT … (Contacts subquery, when readable) FROM Account, with only readable fields. Append WHERE/ORDER/LIMIT. */
export async function accountSelect(sf: SalesforceApi, extra: string[] = []): Promise<string> {
  const account = await selectList(sf, "Account", [...ACCOUNT_FIELDS, ...extra]);
  if (!(await contactsReadable(sf))) return `SELECT ${account} FROM Account`;
  const contact = await selectList(sf, "Contact", CONTACT_FIELDS);
  return `SELECT ${account}, (SELECT ${contact} FROM Contacts ORDER BY CreatedDate) FROM Account`;
}

/** What the integration user can't read that the app uses, for "Test connection". */
export const WANTED: Record<string, string[]> = {
  Account: ["Phone", "Website", "BillingStreet", "BillingCity", "BillingState", "BillingPostalCode", "OwnerId", "Program__c", "Legal_Entity__c", "Effective_Date__c", "Policy_Expiration_Date__c", "Renewal_Status__c", "Annual_Premium__c"],
  Contact: ["Email", "FirstName", "LastName", "Phone", "MobilePhone", "Title", "AccountId"],
  Opportunity: ["StageName", "CloseDate", "AccountId"],
};

export async function accessReport(sf: SalesforceApi): Promise<{ object: string; readable: boolean; missing: string[] }[]> {
  const out = [];
  for (const [object, wanted] of Object.entries(WANTED)) {
    try {
      if (object === "Contact" && !(await contactsReadable(sf))) throw new Error("not readable");
      const visible = await visibleFields(sf, object, wanted);
      out.push({ object, readable: true, missing: wanted.filter((f) => !visible.includes(f)) });
    } catch {
      out.push({ object, readable: false, missing: wanted });
    }
  }
  return out;
}
