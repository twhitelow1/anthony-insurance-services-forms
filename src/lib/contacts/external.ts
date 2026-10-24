import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Contact } from "@/lib/db/schema";
import { addClientEvent, contactEmailsOf, getContact, getContactByEmail, normalizeEmail } from "@/lib/clients/repo";
import { phoneDigits } from "@/lib/clients/text";
import { getContact as getLaContact, ghlConfig, updateContact as updateLaContact } from "@/lib/ghl/client";
import { soqlString } from "@/lib/salesforce/api";
import { salesforceClient } from "@/lib/salesforce/client";
import { selectList } from "@/lib/salesforce/fields";

/**
 * A contact's email and phone as Salesforce and Lead Alchemist have them, kept beside what
 * applicants typed. Nothing here overwrites the app's values: staff compare them and push the
 * application's value to Salesforce or Lead Alchemist only when they choose to.
 */

export type Source = "app" | "salesforce" | "lead_alchemist";
export const SOURCE_LABEL: Record<Source, string> = { app: "earlier applications", salesforce: "Salesforce", lead_alchemist: "Lead Alchemist" };

export interface ContactChange {
  field: "phone" | "email";
  /** What the new application says. */
  value: string;
  /** Where a different value is on file. */
  differsFrom: { source: Source; value: string }[];
}

const samePhone = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && phoneDigits(a) === phoneDigits(b);
const sameEmail = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && normalizeEmail(a) === normalizeEmail(b);

/**
 * Compare what an application says against what's on file for that person: earlier applications,
 * and the Salesforce and Lead Alchemist values last read. Call it before the application's details
 * are saved onto the contact. Reads the app only.
 */
export async function detectContactChanges(input: { email: string; phone?: string | null }): Promise<{ contact: Contact; changes: ContactChange[] } | null> {
  const contact = await getContactByEmail(input.email);
  if (!contact) return null;
  const changes: ContactChange[] = [];

  const phone = input.phone?.trim();
  if (phone && phoneDigits(phone).length >= 10) {
    const differsFrom: ContactChange["differsFrom"] = [];
    const earlier = contact.phones.filter((p) => phoneDigits(p).length >= 10);
    if (earlier.length && !earlier.some((p) => samePhone(p, phone))) differsFrom.push({ source: "app", value: earlier.join(", ") });
    if (contact.sfPhone && !samePhone(contact.sfPhone, phone)) differsFrom.push({ source: "salesforce", value: contact.sfPhone });
    if (contact.laPhone && !samePhone(contact.laPhone, phone)) differsFrom.push({ source: "lead_alchemist", value: contact.laPhone });
    if (differsFrom.length) changes.push({ field: "phone", value: phone, differsFrom });
  }

  const differsFrom: ContactChange["differsFrom"] = [];
  if (contact.sfEmail && !sameEmail(contact.sfEmail, input.email)) differsFrom.push({ source: "salesforce", value: contact.sfEmail });
  if (contact.laEmail && !sameEmail(contact.laEmail, input.email)) differsFrom.push({ source: "lead_alchemist", value: contact.laEmail });
  if (differsFrom.length) changes.push({ field: "email", value: normalizeEmail(input.email), differsFrom });

  return { contact, changes };
}

/** One line per change, for the staff email and the notification. */
export const describeChanges = (changes: ContactChange[]) =>
  changes.map(
    (c) =>
      `${c.field === "phone" ? "Phone" : "Email"} on this application (${c.value}) differs from ${c.differsFrom
        .map((d) => `${SOURCE_LABEL[d.source]} (${d.value})`)
        .join(" and ")}.`,
  );

/** Read the linked Salesforce Contact's and Lead Alchemist contact's email and phone, and store them beside the app's. */
export async function refreshContactExternal(contactId: string): Promise<Contact> {
  const contact = await getContact(contactId);
  if (!contact) throw new Error("That contact no longer exists.");
  const patch: Partial<Contact> = { externalCheckedAt: new Date() };
  if (contact.sfContactId) {
    const sf = await salesforceClient();
    if (sf) {
      const [row] = await sf.query<{ Id: string; Email: string | null; Phone: string | null; MobilePhone: string | null }>(
        `SELECT ${await selectList(sf, "Contact", ["Email", "Phone", "MobilePhone"])} FROM Contact WHERE Id = ${soqlString(contact.sfContactId)} LIMIT 1`,
      );
      patch.sfEmail = row?.Email ? normalizeEmail(row.Email) : null;
      patch.sfPhone = row?.Phone || row?.MobilePhone || null;
    }
  }
  if (contact.ghlContactId && (await ghlConfig())) {
    const la = await getLaContact(contact.ghlContactId);
    patch.laEmail = la?.email ? normalizeEmail(la.email) : null;
    patch.laPhone = la?.phone ?? null;
  }
  const db = await getDb();
  const [updated] = await db.update(schema.contacts).set(patch).where(eq(schema.contacts.id, contact.id)).returning();
  return updated;
}

/** Where the app's values and the stored Salesforce / Lead Alchemist values differ (for the account page). */
export async function externalDifferences(contact: Contact): Promise<ContactChange[]> {
  const emails = await contactEmailsOf(contact.id);
  const out: ContactChange[] = [];
  const phone = contact.phones[0];
  if (phone) {
    const differsFrom: ContactChange["differsFrom"] = [];
    if (contact.sfPhone && !contact.phones.some((p) => samePhone(p, contact.sfPhone))) differsFrom.push({ source: "salesforce", value: contact.sfPhone });
    if (contact.laPhone && !contact.phones.some((p) => samePhone(p, contact.laPhone))) differsFrom.push({ source: "lead_alchemist", value: contact.laPhone });
    if (differsFrom.length) out.push({ field: "phone", value: phone, differsFrom });
  }
  const email = contact.primaryEmail ?? emails[0];
  if (email) {
    const differsFrom: ContactChange["differsFrom"] = [];
    if (contact.sfEmail && !emails.some((e) => sameEmail(e, contact.sfEmail))) differsFrom.push({ source: "salesforce", value: contact.sfEmail });
    if (contact.laEmail && !emails.some((e) => sameEmail(e, contact.laEmail))) differsFrom.push({ source: "lead_alchemist", value: contact.laEmail });
    if (differsFrom.length) out.push({ field: "email", value: email, differsFrom });
  }
  return out;
}

/**
 * Push one of the app's values to Salesforce or Lead Alchemist (on demand only). An update of one
 * field on the linked record; nothing is created or deleted.
 */
export async function pushContactValue(contactId: string, target: "salesforce" | "lead_alchemist", field: "phone" | "email", value: string, actor: string) {
  const contact = await getContact(contactId);
  if (!contact) throw new Error("That contact no longer exists.");
  const v = field === "email" ? normalizeEmail(value) : value.trim();
  const known = field === "email" ? await contactEmailsOf(contact.id) : contact.phones;
  if (!known.some((k) => (field === "email" ? sameEmail(k, v) : samePhone(k, v)))) throw new Error("That value isn't on this contact in the app.");
  if (target === "salesforce") {
    if (!contact.sfContactId) throw new Error("This contact isn't linked to a Salesforce Contact.");
    const sf = await salesforceClient();
    if (!sf) throw new Error("Salesforce isn't connected. Add the keys in Settings → Integrations.");
    await sf.update("Contact", contact.sfContactId, field === "phone" ? { Phone: v } : { Email: v });
  } else {
    if (!contact.ghlContactId) throw new Error("This contact isn't linked to a Lead Alchemist contact.");
    if (!(await ghlConfig())) throw new Error("Lead Alchemist isn't connected. Add the keys in Settings → Integrations.");
    await updateLaContact(contact.ghlContactId, field === "phone" ? { phone: v } : { email: v });
  }
  const db = await getDb();
  await db
    .update(schema.contacts)
    .set(target === "salesforce" ? (field === "phone" ? { sfPhone: v } : { sfEmail: v }) : field === "phone" ? { laPhone: v } : { laEmail: v })
    .where(eq(schema.contacts.id, contact.id));
  const where = target === "salesforce" ? "Salesforce" : "Lead Alchemist";
  await addClientEvent(contact.clientId, "contact_pushed", actor, { message: `${contact.name}: ${field} sent to ${where} from the app` });
  return { contact, where };
}
