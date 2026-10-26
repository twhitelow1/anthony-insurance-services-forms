import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Contact } from "@/lib/db/schema";
import { addClientEvent, contactEmailsOf, getClient, getContact, getContactByEmail, normalizeEmail } from "@/lib/clients/repo";
import { laCompanyName, phoneDigits } from "@/lib/clients/text";
import { addTags as addLaTags, getContact as getLaContact, ghlConfig, updateContact as updateLaContact } from "@/lib/ghl/client";
import { soqlString } from "@/lib/salesforce/api";
import { salesforceClient } from "@/lib/salesforce/client";
import { selectList } from "@/lib/salesforce/fields";
import { LINK_FIELDS, prepareFields } from "@/lib/salesforce/mapping";
import { ghlLinkWriter } from "@/lib/ghl/links";
import { links as appLinks } from "@/lib/integrations/links";

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
export async function refreshContactExternal(contactId: string, actor = "system"): Promise<Contact> {
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
  // Log what changed since the last read (the very first read of a person is a baseline, not a change).
  if (contact.externalCheckedAt) {
    const { recordContactChanges } = await import("./changes");
    await recordContactChanges(
      contact.id,
      contact.clientId,
      [
        ...("sfEmail" in patch ? [{ system: "salesforce" as const, direction: "read" as const, field: "Email", oldValue: contact.sfEmail, newValue: patch.sfEmail }] : []),
        ...("sfPhone" in patch ? [{ system: "salesforce" as const, direction: "read" as const, field: "Phone", oldValue: contact.sfPhone, newValue: patch.sfPhone }] : []),
        ...("laEmail" in patch ? [{ system: "lead_alchemist" as const, direction: "read" as const, field: "Email", oldValue: contact.laEmail, newValue: patch.laEmail }] : []),
        ...("laPhone" in patch ? [{ system: "lead_alchemist" as const, direction: "read" as const, field: "Phone", oldValue: contact.laPhone, newValue: patch.laPhone }] : []),
      ],
      actor,
    );
  }
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
  if (!known.some((k) => (field === "email" ? sameEmail(k, v) : samePhone(k, v)))) throw new Error("That value isn't on this contact in AIS Connect.");
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
  await addClientEvent(contact.clientId, "contact_pushed", actor, { message: `${contact.name}: ${field} sent to ${where} from AIS Connect` });
  return { contact, where };
}

const blank = (v: string | null | undefined) => !v?.trim();
/** Lead Alchemist names a phone-only caller after the number; treat that as no name. */
const looksLikePhone = (v: string | null | undefined) => !!v && /^[+\d\s().-]{7,}$/.test(v.trim());
const splitName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
};

export type LaDetailField = "firstName" | "lastName" | "email" | "phone" | "companyName" | "address1" | "city" | "state" | "postalCode";
const FIELD_LABEL: Record<LaDetailField, string> = {
  firstName: "first name",
  lastName: "last name",
  email: "email",
  phone: "phone",
  companyName: "company name",
  address1: "street",
  city: "city",
  state: "state",
  postalCode: "ZIP",
};

/**
 * Fill in the linked Lead Alchemist contact from what the app knows (falling back to Salesforce's
 * values): first and last name, email, phone, company name (the Account's name, as in Salesforce)
 * and the Account's address. By default only fields that are empty in Lead Alchemist are filled
 * (e.g. a caller saved with just a phone number); with `replace`, fields that differ are replaced
 * too. Also writes the links to the app's account page and the Salesforce Account and Contact onto
 * the Lead Alchemist contact, so staff can click between the three. Logged on the account.
 */
export async function updateLeadAlchemistDetails(contactId: string, actor: string, { replace = false }: { replace?: boolean } = {}) {
  const contact = await getContact(contactId);
  if (!contact) throw new Error("That contact no longer exists.");
  if (!contact.ghlContactId) throw new Error(`${contact.name} isn't linked to a Lead Alchemist contact yet: sync them to Lead Alchemist first.`);
  if (!(await ghlConfig())) throw new Error("Lead Alchemist isn't connected. Add the keys in Settings → Integrations.");
  const la = await getLaContact(contact.ghlContactId);
  if (!la) throw new Error(`${contact.name}'s Lead Alchemist contact wasn't found (it may have been deleted or merged there).`);
  const account = await getClient(contact.clientId);
  const fallback = splitName(contact.name);
  const want: Record<LaDetailField, string | null> = {
    firstName: contact.firstName ?? (fallback.first || null),
    lastName: contact.lastName ?? (fallback.last || null),
    email: contact.primaryEmail ?? contact.sfEmail ?? null,
    phone: contact.phones[0] ?? contact.sfPhone ?? null,
    companyName: account ? laCompanyName(account) : null,
    address1: account?.address?.street ?? null,
    city: account?.address?.city ?? null,
    state: account?.address?.state ?? null,
    postalCode: account?.address?.postalCode ?? null,
  };
  const have: Record<LaDetailField, string | null | undefined> = {
    firstName: la.firstName,
    lastName: la.lastName,
    email: la.email,
    phone: la.phone,
    companyName: la.companyName,
    address1: la.address1,
    city: la.city,
    state: la.state,
    postalCode: la.postalCode,
  };
  const same = (f: LaDetailField, a: string, b: string) =>
    f === "email" ? sameEmail(a, b) : f === "phone" ? phoneDigits(a).slice(-10) === phoneDigits(b).slice(-10) : a.trim().toLowerCase() === b.trim().toLowerCase();
  const changes: Partial<Record<LaDetailField, string>> = {};
  for (const f of Object.keys(want) as LaDetailField[]) {
    const w = want[f];
    if (!w?.trim()) continue;
    const h = have[f];
    const missing = blank(h) || ((f === "firstName" || f === "lastName") && looksLikePhone(h));
    if (missing || (replace && !same(f, h!, w))) changes[f] = w.trim();
  }
  const fields = Object.keys(changes) as LaDetailField[];
  const l = await appLinks();
  const notes: string[] = [];
  // The links, the Account Type and the client tier are the app's own fields on the Lead
  // Alchemist contact: always kept current, but an empty Account Type never blanks one there.
  const written = await ghlLinkWriter
    .contactLinks(
      contact.ghlContactId,
      {
        clientPage: l.appClient(contact.clientId),
        salesforceAccount: account?.sfAccountId ? l.salesforce("Account", account.sfAccountId) : null,
        salesforceContact: contact.sfContactId ? l.salesforce("Contact", contact.sfContactId) : null,
        accountType: account?.sfAccountType ?? null,
        clientTier: account ? (account.primaryContactId === contact.id ? "Primary" : "Secondary") : null,
      },
      la,
    )
    .catch((err: unknown) => {
      notes.push(`couldn't write the Lead Alchemist link, Account Type and Client Tier fields (${err instanceof Error ? err.message : String(err)})`);
      return null;
    });
  for (const c of written?.changed ?? []) notes.push(`${c.field} changed in Lead Alchemist: ${c.from} → ${c.to}`);
  const { recordContactChanges } = await import("./changes");
  const log = (entries: { field: string; oldValue?: string | null; newValue?: string | null }[]) =>
    recordContactChanges(contact.id, contact.clientId, entries.map((e) => ({ ...e, system: "lead_alchemist" as const, direction: "wrote" as const })), actor).catch(() => {});
  await log((written?.changed ?? []).map((c) => ({ field: c.field, oldValue: c.from, newValue: c.to })));
  if (written?.missing.length) notes.push(`couldn't create the Lead Alchemist field${written.missing.length === 1 ? "" : "s"} ${written.missing.join(", ")} (the token needs the custom fields scope)`);
  // The built-in Contact Type is the Salesforce Account Type (Anthony's account has the same
  // options). Salesforce is the only place it changes; an empty Type never blanks it.
  const sfType = account?.sfAccountType?.trim();
  const laType = la.type?.trim() ?? "";
  if (sfType && laType.toLowerCase() !== sfType.toLowerCase()) {
    try {
      await updateLaContact(contact.ghlContactId, { type: sfType });
      notes.push(laType ? `Contact Type changed in Lead Alchemist: ${laType} → ${sfType}` : `Contact Type set in Lead Alchemist: ${sfType}`);
      await log([{ field: "Contact Type", oldValue: laType || null, newValue: sfType }]);
    } catch (err) {
      notes.push(`couldn't set the Lead Alchemist Contact Type to "${sfType}" (${err instanceof Error ? err.message : String(err)}); check that it's one of the Contact Type options there`);
    }
  }
  // Tags so marketing can find everyone AIS Connect put in Lead Alchemist (only ever added).
  const wantTags = ["ais-connect", account?.isIndividual ? "ais-personal" : "ais-business"].filter((tag) => !(la.tags ?? []).includes(tag));
  if (wantTags.length)
    await addLaTags(contact.ghlContactId, wantTags)
      .then(() => log([{ field: "Tags added", newValue: wantTags.join(", ") }]))
      .catch((err: unknown) => notes.push(`couldn't add the tags ${wantTags.join(", ")} (${err instanceof Error ? err.message : String(err)})`));
  // And on the Salesforce Contact: its Lead Alchemist contact and the app's account page.
  if (contact.sfContactId) {
    const sf = await salesforceClient();
    if (sf) {
      await sf
        .describe("Contact")
        .then((d) => prepareFields(d, { [LINK_FIELDS.Contact.laContact]: l.ghlContact(contact.ghlContactId), [LINK_FIELDS.Contact.applications]: l.appClient(contact.clientId) }, "update").data)
        .then((data) => (Object.keys(data).length ? sf.update("Contact", contact.sfContactId!, data) : undefined))
        .catch(() => {});
    }
  }
  if (!fields.length) return { contact, fields, changes: notes };
  try {
    await updateLaContact(contact.ghlContactId, changes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${contact.name}: Lead Alchemist refused the update (${msg}). Another Lead Alchemist contact may already have this email or phone.`);
  }
  const db = await getDb();
  await db
    .update(schema.contacts)
    .set({ updatedAt: new Date(), ...(changes.email ? { laEmail: changes.email } : {}), ...(changes.phone ? { laPhone: changes.phone } : {}) })
    .where(eq(schema.contacts.id, contact.id));
  await addClientEvent(contact.clientId, "contact_pushed", actor, {
    message: `${contact.name}: Lead Alchemist contact updated from AIS Connect (${fields.map((f) => FIELD_LABEL[f]).join(", ")})`,
  });
  await log(fields.map((f) => ({ field: FIELD_LABEL[f], oldValue: have[f] ?? null, newValue: changes[f] ?? null })));
  return { contact, fields, changes: notes };
}
