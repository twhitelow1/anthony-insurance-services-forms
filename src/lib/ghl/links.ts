import "server-only";
import { addContactNote, ghlConfig, updateContact, updateOpportunity, type GhlContact } from "./client";
import { CONTACT_INFO_FIELDS, CONTACT_LINK_FIELDS, ensureCustomFields, findField, OPPORTUNITY_LINK_FIELDS } from "./sync";

/**
 * Writes the three-way links onto Lead Alchemist records: Salesforce Account and Client page
 * on the contact, Salesforce Opportunity and the application on the opportunity, plus a note.
 * The fields are created on first use (same mechanism as the application fields).
 */
export interface GhlLinkWriter {
  contactLinks(
    contactId: string,
    links: { salesforceAccount?: string | null; salesforceContact?: string | null; clientPage?: string | null; accountType?: string | null; clientTier?: string | null },
    /** The contact as just read, to say which values changed. */
    current?: GhlContact | null,
  ): Promise<{ missing: string[]; changed: { field: string; from: string; to: string }[] }>;
  opportunityLinks(opportunityId: string, links: { salesforceOpportunity?: string | null; application?: string | null }): Promise<{ missing: string[] }>;
  note(contactId: string, body: string): Promise<void>;
}

/** Values for these fields (created on first use). An empty value is left out, so it never blanks a field. */
async function fieldValues(model: "contact" | "opportunity", wanted: [string, string | null | undefined][], current?: { id: string; value?: unknown }[]) {
  const present = wanted.filter((w): w is [string, string] => !!w[1]?.trim());
  const changed: { field: string; from: string; to: string }[] = [];
  if (!present.length) return { customFields: [], missing: [] as string[], changed };
  const { fields, missing } = await ensureCustomFields(model, present.map(([n]) => n));
  const customFields = present.flatMap(([name, value]) => {
    const f = findField(fields, name);
    if (!f) return [];
    const was = current?.find((c) => c.id === f.id)?.value;
    if (typeof was === "string" && was.trim() && was.trim() !== value.trim()) changed.push({ field: name, from: was.trim(), to: value.trim() });
    return [{ id: f.id, field_value: value }];
  });
  return { customFields, missing, changed };
}

export const ghlLinkWriter: GhlLinkWriter = {
  async contactLinks(contactId, links, current) {
    const { customFields, missing, changed } = await fieldValues(
      "contact",
      [
        [CONTACT_LINK_FIELDS.salesforceAccount, links.salesforceAccount],
        [CONTACT_LINK_FIELDS.salesforceContact, links.salesforceContact],
        [CONTACT_LINK_FIELDS.clientPage, links.clientPage],
        [CONTACT_INFO_FIELDS.accountType, links.accountType],
        [CONTACT_INFO_FIELDS.clientTier, links.clientTier],
      ],
      current?.customFields,
    );
    if (customFields.length) await updateContact(contactId, { customFields });
    return { missing, changed: changed.filter((c) => c.field === CONTACT_INFO_FIELDS.accountType || c.field === CONTACT_INFO_FIELDS.clientTier) };
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
