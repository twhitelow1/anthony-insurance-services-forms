import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { SfAccountSnapshot } from "@/lib/db/schema";
import { addClientEvent, ensureContact, getClient, getContactByEmail, getContactBySalesforceId, refreshSearch, setClientSalesforce } from "@/lib/clients/repo";
import { refreshContactExternal } from "@/lib/contacts/external";
import { raiseNotification } from "@/lib/notifications/repo";
import { soqlString, type SalesforceApi } from "./api";
import { accountSelect } from "./fields";
import { hiddenSet } from "./hidden";

/**
 * "Refresh from Salesforce" on an Account (by hand, never on a schedule):
 * - stores what Salesforce says about the Account, including the policy and renewal fields, beside
 *   the app's own values (the app's values are never overwritten);
 * - adds Salesforce Contacts the app doesn't have yet under the Account, and raises a notification
 *   for each so staff can pair them with Lead Alchemist;
 * - reads each linked contact's Salesforce and Lead Alchemist email and phone for comparison.
 */

/** Account fields read when the org has them (custom ones are checked against describe first). */
const OPTIONAL_FIELDS = {
  type: "Type",
  program: "Program__c",
  legalEntity: "Legal_Entity__c",
  effectiveDate: "Effective_Date__c",
  expirationDate: "Policy_Expiration_Date__c",
  renewalStatus: "Renewal_Status__c",
  annualPremium: "Annual_Premium__c",
} as const;

type Row = Record<string, unknown> & {
  Id: string;
  Name: string;
  Phone: string | null;
  Website: string | null;
  BillingStreet: string | null;
  BillingCity: string | null;
  BillingState: string | null;
  BillingPostalCode: string | null;
  Owner?: { Name?: string | null } | null;
  Contacts?: { records: { Id: string; Email: string | null; FirstName: string | null; LastName: string | null; Phone: string | null; Title: string | null }[] } | null;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function readAccountSnapshot(sf: SalesforceApi, sfAccountId: string): Promise<{ snapshot: SfAccountSnapshot; row: Row } | null> {
  const [row] = await sf.query<Row>(`${await accountSelect(sf, ["Owner.Name", ...Object.values(OPTIONAL_FIELDS)])} WHERE Id = ${soqlString(sfAccountId)} LIMIT 1`);
  if (!row) return null;
  const premium = row[OPTIONAL_FIELDS.annualPremium];
  return {
    row,
    snapshot: {
      name: row.Name,
      type: str(row[OPTIONAL_FIELDS.type]),
      phone: row.Phone,
      website: row.Website,
      address: [row.BillingStreet, row.BillingCity, row.BillingState, row.BillingPostalCode].filter(Boolean).join(", ") || null,
      program: str(row[OPTIONAL_FIELDS.program]),
      legalEntity: str(row[OPTIONAL_FIELDS.legalEntity]),
      effectiveDate: str(row[OPTIONAL_FIELDS.effectiveDate]),
      expirationDate: str(row[OPTIONAL_FIELDS.expirationDate]),
      renewalStatus: str(row[OPTIONAL_FIELDS.renewalStatus]),
      annualPremium: typeof premium === "number" ? premium : null,
      ownerName: row.Owner?.Name ?? null,
    },
  };
}

export async function refreshAccountFromSalesforce(clientId: string, sf: SalesforceApi, actor: string) {
  const client = await getClient(clientId);
  if (!client) throw new Error("That Account no longer exists.");
  if (!client.sfAccountId) throw new Error("This Account isn't linked to Salesforce yet. Find it on Admin → Salesforce first.");
  const read = await readAccountSnapshot(sf, client.sfAccountId);
  if (!read) throw new Error("The linked Salesforce Account wasn't found (it may have been deleted in Salesforce).");
  await setClientSalesforce(client.id, { sfPulledAt: new Date() });
  const db = await getDb();
  await db.update(schema.clients).set({ sfSnapshot: read.snapshot, sfAccountType: read.snapshot.type ?? null }).where(eq(schema.clients.id, client.id));

  // Salesforce Contacts the app doesn't have yet: add them under this Account, unless removed here.
  const sfContacts = read.row.Contacts?.records ?? [];
  const hidden = await hiddenSet(sfContacts.map((c) => c.Id));
  let added = 0;
  for (const c of sfContacts) {
    if (hidden.has(c.Id)) continue;
    const existing = (await getContactBySalesforceId(c.Id)) ?? (c.Email ? await getContactByEmail(c.Email) : undefined);
    if (existing) {
      if (!existing.sfContactId) await db.update(schema.contacts).set({ sfContactId: c.Id }).where(eq(schema.contacts.id, existing.id));
      continue;
    }
    const contact = await ensureContact({ clientId: client.id, email: c.Email, firstName: c.FirstName, lastName: c.LastName, title: c.Title, phone: c.Phone, sfContactId: c.Id });
    added++;
    await raiseNotification(
      {
        kind: "sf_new_contact",
        title: `New Salesforce contact: ${contact.name}`,
        detail: `Added under ${client.name} from Salesforce. Pair them with their Lead Alchemist contact on the account page.`,
        clientId: client.id,
        contactId: contact.id,
        dedupeKey: `sf_new_contact:${c.Id}`,
      },
      actor,
    );
  }
  if (added) await refreshSearch(client.id);

  // Everyone on the Account: their Salesforce and Lead Alchemist email and phone, for comparison.
  const people = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.clientId, client.id));
  for (const p of people) await refreshContactExternal(p.id).catch((err) => console.warn("[refresh] contact", err instanceof Error ? err.message : err));

  await addClientEvent(client.id, "sf_refreshed", actor, {
    message: `Read from Salesforce${added ? `; ${added} new contact${added === 1 ? "" : "s"} added` : ""}. Nothing in AIS Connect was overwritten.`,
  });
  return { snapshot: read.snapshot, added };
}
