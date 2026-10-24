import { nameKey, phoneDigits } from "@/lib/clients/text";
import { soqlString, type SalesforceApi } from "./api";

/**
 * Finding an Account in Salesforce without ever creating a duplicate (the org has no
 * duplicate rules, so this is the only guard).
 *
 * A business:
 * 1. An Account with exactly the same name AND the same phone → that Account.
 * 2. No Account with that name: a Contact with the applicant's email whose Account has the
 *    same name (ignoring punctuation and LLC/Inc) → that Account.
 * 3. Anything uncertain (several Accounts, a name match whose phone differs or is missing) →
 *    "review": nothing is created and staff decide in the admin.
 * 4. Otherwise a new Account.
 *
 * An individual (no business name): a Contact with their email → its Account; then as above
 * with their name.
 */
export type MatchResult =
  | { kind: "contact"; accountId: string; contactId: string; accountName: string }
  | { kind: "account"; accountId: string; accountName: string }
  | { kind: "new" }
  | { kind: "review"; reason: string };

export interface MatchInput {
  email: string;
  /** The app Account's name: the business, or the person for an individual. */
  accountName: string;
  phone?: string | null;
  isIndividual?: boolean;
}

type ContactRow = { Id: string; AccountId: string | null; Email: string | null; Account?: { Name?: string } | null };
type AccountRow = { Id: string; Name: string; Phone: string | null };

async function contactsByEmail(api: SalesforceApi, email: string): Promise<ContactRow[]> {
  // SOQL compares emails case-insensitively.
  return api.query<ContactRow>(`SELECT Id, AccountId, Email, Account.Name FROM Contact WHERE Email = ${soqlString(email)} ORDER BY CreatedDate ASC LIMIT 10`);
}

export async function matchSalesforce(api: SalesforceApi, input: MatchInput): Promise<MatchResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.accountName.trim();

  if (input.isIndividual && email) {
    const contacts = await contactsByEmail(api, email);
    const withAccount = contacts.filter((c) => c.AccountId);
    const accounts = [...new Set(withAccount.map((c) => c.AccountId!))];
    if (accounts.length === 1) {
      const c = withAccount[0];
      return { kind: "contact", accountId: c.AccountId!, contactId: c.Id, accountName: c.Account?.Name ?? name };
    }
    if (accounts.length > 1) return { kind: "review", reason: `${accounts.length} Salesforce Accounts have a Contact with this email` };
    if (contacts.length) return { kind: "review", reason: "A Salesforce Contact has this email but isn't on an Account" };
  }

  if (!name) return { kind: "new" };
  const accounts = await api.query<AccountRow>(`SELECT Id, Name, Phone FROM Account WHERE Name = ${soqlString(name)} LIMIT 10`);
  if (accounts.length) {
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

  if (!input.isIndividual && email) {
    // The applicant is already a Contact on an Account whose name differs only in punctuation or "LLC".
    const key = nameKey(name);
    const onSameBusiness = (await contactsByEmail(api, email)).filter((c) => c.AccountId && nameKey(c.Account?.Name) === key);
    const accountIds = [...new Set(onSameBusiness.map((c) => c.AccountId!))];
    if (accountIds.length === 1) {
      const c = onSameBusiness[0];
      return { kind: "contact", accountId: c.AccountId!, contactId: c.Id, accountName: c.Account?.Name ?? name };
    }
    if (accountIds.length > 1) return { kind: "review", reason: `${accountIds.length} Salesforce Accounts named like "${name}" have a Contact with this email` };
  }
  return { kind: "new" };
}

/** The applicant's Salesforce Contact: on this Account first, else the one Contact anywhere with this email. */
export async function matchContact(api: SalesforceApi, accountId: string, email: string): Promise<string | null> {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const contacts = await contactsByEmail(api, e);
  const here = contacts.find((c) => c.AccountId === accountId);
  if (here) return here.Id;
  return contacts.length === 1 ? contacts[0].Id : null;
}
