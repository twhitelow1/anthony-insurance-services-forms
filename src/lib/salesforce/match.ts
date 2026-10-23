import { phoneDigits } from "@/lib/clients/text";
import { soqlString, type SalesforceApi } from "./api";

/**
 * Finding the applicant in Salesforce without ever creating a duplicate (the org has no
 * duplicate rules, so this is the only guard):
 * 1. A Contact with the applicant's email → its Account.
 * 2. Otherwise an Account with exactly the same name AND the same phone → that Account.
 * 3. Anything uncertain (several contacts or accounts, a name match whose phone differs or is
 *    missing) → "review": nothing is created and staff decide in the admin.
 * 4. Otherwise a new client.
 */
export type MatchResult =
  | { kind: "contact"; accountId: string; contactId: string; accountName: string }
  | { kind: "account"; accountId: string; accountName: string }
  | { kind: "new" }
  | { kind: "review"; reason: string };

export interface MatchInput {
  email: string;
  /** The Account name the app would use: business name, else the person's name. */
  accountName: string;
  phone?: string | null;
}

type ContactRow = { Id: string; AccountId: string | null; Email: string | null; Account?: { Name?: string } | null };
type AccountRow = { Id: string; Name: string; Phone: string | null };

export async function matchSalesforce(api: SalesforceApi, input: MatchInput): Promise<MatchResult> {
  const email = input.email.trim().toLowerCase();
  if (email) {
    // SOQL compares emails case-insensitively.
    const contacts = await api.query<ContactRow>(
      `SELECT Id, AccountId, Email, Account.Name FROM Contact WHERE Email = ${soqlString(email)} ORDER BY CreatedDate ASC LIMIT 10`,
    );
    const withAccount = contacts.filter((c) => c.AccountId);
    const accounts = [...new Set(withAccount.map((c) => c.AccountId!))];
    if (accounts.length === 1) {
      const c = withAccount[0];
      return { kind: "contact", accountId: c.AccountId!, contactId: c.Id, accountName: c.Account?.Name ?? input.accountName };
    }
    if (accounts.length > 1) return { kind: "review", reason: `${accounts.length} Salesforce Accounts have a Contact with this email` };
    if (contacts.length) return { kind: "review", reason: "A Salesforce Contact has this email but isn't on an Account" };
  }

  const name = input.accountName.trim();
  if (!name) return { kind: "new" };
  const accounts = await api.query<AccountRow>(`SELECT Id, Name, Phone FROM Account WHERE Name = ${soqlString(name)} LIMIT 10`);
  if (!accounts.length) return { kind: "new" };
  const digits = phoneDigits(input.phone);
  const samePhone = digits ? accounts.filter((a) => phoneDigits(a.Phone) === digits) : [];
  if (samePhone.length === 1) return { kind: "account", accountId: samePhone[0].Id, accountName: samePhone[0].Name };
  if (samePhone.length > 1) return { kind: "review", reason: `${samePhone.length} Salesforce Accounts have this name and phone` };
  return {
    kind: "review",
    reason: digits
      ? `A Salesforce Account named "${name}" exists with a different phone number`
      : `A Salesforce Account named "${name}" exists and the application has no phone number to confirm it`,
  };
}
