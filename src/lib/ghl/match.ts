import "server-only";
import type { Contact } from "@/lib/db/schema";
import { addClientEvent, contactEmailsOf, getContact, setContactGhl } from "@/lib/clients/repo";
import { linkApplicantGhl } from "@/lib/applications/repo";
import { phoneDigits } from "@/lib/clients/text";
import { findContactByEmail, findContactByPhone, getContact as getGhlContact, searchContacts, type GhlContact } from "./client";

/**
 * Find a contact's Lead Alchemist contact by email or phone (exact, Lead Alchemist's own
 * duplicate lookup) and by name (a hint only), and link them. Linking saves the Lead Alchemist
 * ID in this app; it changes nothing in Lead Alchemist.
 */
export interface LaCandidate {
  contact: GhlContact;
  /** How it was found: email and phone are exact matches; name is a suggestion to check. */
  how: ("email" | "phone" | "name")[];
}

export const laName = (c: GhlContact) => c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.phone || c.id;

export async function laCandidates(contact: Pick<Contact, "id" | "name" | "phones">, opts: { byName?: boolean } = {}): Promise<LaCandidate[]> {
  const found = new Map<string, LaCandidate>();
  const add = (c: GhlContact | null | undefined, how: LaCandidate["how"][number]) => {
    if (!c?.id) return;
    const prev = found.get(c.id);
    if (prev) {
      if (!prev.how.includes(how)) prev.how.push(how);
    } else found.set(c.id, { contact: c, how: [how] });
  };
  for (const email of (await contactEmailsOf(contact.id)).slice(0, 5)) add(await findContactByEmail(email), "email");
  const phones = [...new Set(contact.phones.map(phoneDigits).filter((d) => d.length >= 10))].slice(0, 3);
  for (const p of phones) add(await findContactByPhone(p), "phone");
  if (opts.byName !== false && contact.name.trim().length > 2) {
    for (const c of await searchContacts({ query: contact.name, limit: 5 })) add(c, "name");
  }
  // Exact matches first.
  return [...found.values()].sort((a, b) => Number(b.how.some((h) => h !== "name")) - Number(a.how.some((h) => h !== "name")));
}

/** The one exact (email or phone) match, when there's exactly one. */
export function exactMatch(candidates: LaCandidate[]): GhlContact | null {
  const exact = candidates.filter((c) => c.how.some((h) => h !== "name"));
  return exact.length === 1 ? exact[0].contact : null;
}

/** Save the link (this app only), and on the applicant record for each of the contact's emails. */
export async function linkLaContact(contactId: string, ghlContactId: string, actor: string) {
  const contact = await getContact(contactId);
  if (!contact) throw new Error("That contact no longer exists.");
  const la = await getGhlContact(ghlContactId);
  if (!la) throw new Error("That Lead Alchemist contact wasn't found.");
  await setContactGhl(contact.id, la.id);
  for (const email of await contactEmailsOf(contact.id)) await linkApplicantGhl(email, la.id);
  await addClientEvent(contact.clientId, "la_contact_linked", actor, { message: `${contact.name} linked to Lead Alchemist contact ${la.id}` });
  return { contact, la };
}

/** Forget the link in this app (the Lead Alchemist contact is untouched). */
export async function unlinkLaContact(contactId: string, actor: string) {
  const contact = await getContact(contactId);
  if (!contact) throw new Error("That contact no longer exists.");
  await setContactGhl(contact.id, null);
  for (const email of await contactEmailsOf(contact.id)) await linkApplicantGhl(email, null);
  await addClientEvent(contact.clientId, "la_contact_linked", actor, { message: `${contact.name} unlinked from Lead Alchemist in AIS Connect (nothing changed in Lead Alchemist)` });
  return contact;
}
