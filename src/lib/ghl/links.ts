import "server-only";
import { addContactNote, ghlConfig, updateContact, updateOpportunity } from "./client";
import { CONTACT_LINK_FIELDS, ensureCustomFields, findField, OPPORTUNITY_LINK_FIELDS } from "./sync";

/**
 * Writes the three-way links onto Lead Alchemist records: Salesforce Account and Client page
 * on the contact, Salesforce Opportunity and the application on the opportunity, plus a note.
 * The fields are created on first use (same mechanism as the application fields).
 */
export interface GhlLinkWriter {
  contactLinks(
    contactId: string,
    links: { salesforceAccount?: string | null; salesforceContact?: string | null; clientPage?: string | null },
  ): Promise<{ missing: string[] }>;
  opportunityLinks(opportunityId: string, links: { salesforceOpportunity?: string | null; application?: string | null }): Promise<{ missing: string[] }>;
  note(contactId: string, body: string): Promise<void>;
}

async function fieldValues(model: "contact" | "opportunity", wanted: [string, string | null | undefined][]) {
  const present = wanted.filter((w): w is [string, string] => !!w[1]);
  if (!present.length) return { customFields: [], missing: [] as string[] };
  const { fields, missing } = await ensureCustomFields(model, present.map(([n]) => n));
  const customFields = present.flatMap(([name, value]) => {
    const f = findField(fields, name);
    return f ? [{ id: f.id, field_value: value }] : [];
  });
  return { customFields, missing };
}

export const ghlLinkWriter: GhlLinkWriter = {
  async contactLinks(contactId, links) {
    const { customFields, missing } = await fieldValues("contact", [
      [CONTACT_LINK_FIELDS.salesforceAccount, links.salesforceAccount],
      [CONTACT_LINK_FIELDS.salesforceContact, links.salesforceContact],
      [CONTACT_LINK_FIELDS.clientPage, links.clientPage],
    ]);
    if (customFields.length) await updateContact(contactId, { customFields });
    return { missing };
  },
  async opportunityLinks(opportunityId, links) {
    const { customFields, missing } = await fieldValues("opportunity", [
      [OPPORTUNITY_LINK_FIELDS.salesforceOpportunity, links.salesforceOpportunity],
      [OPPORTUNITY_LINK_FIELDS.application, links.application],
    ]);
    if (customFields.length) await updateOpportunity(opportunityId, { customFields });
    return { missing };
  },
  async note(contactId, body) {
    await addContactNote(contactId, body);
  },
};

/** The writer, or null when Lead Alchemist isn't connected. */
export const ghlLinks = async (): Promise<GhlLinkWriter | null> => ((await ghlConfig()) ? ghlLinkWriter : null);
