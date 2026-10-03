import "server-only";
import type { Application } from "@/lib/db/schema";
import { STATUSES, type ApplicationStatus } from "@/lib/applications/status";
import type { FormDefinition, FormValues } from "@/lib/forms/types";
import { isInputField } from "@/lib/forms/types";
import {
  type GhlCustomField,
  type UpsertContactInput,
  addContactNote,
  addTags,
  listCustomFields,
  removeTags,
  updateContact,
  upsertContact,
} from "./client";

/**
 * GHL holds the contact only. These three custom fields (create them in GHL as
 * single-line text) point staff back to the full application in the portal.
 * Matching is by name and ignores case/spacing/punctuation.
 */
export const PORTAL_FIELDS = {
  reference: "Application Reference",
  status: "Application Status",
  link: "Application Link",
} as const;

export const statusTag = (s: ApplicationStatus) => `app-status:${s}`;

export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function findField(fields: GhlCustomField[], name: string): GhlCustomField | undefined {
  const n = normalize(name);
  return fields.find((f) => normalize(f.name) === n || normalize(f.fieldKey.replace(/^contact\./, "")) === n);
}

export const adminUrl = (app: Pick<Application, "id">) =>
  `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/admin/applications/${app.id}`;

/** Standard contact fields copied from the answers (fields marked `ghl.standard`). */
export function standardContactFields(form: FormDefinition, values: FormValues): UpsertContactInput {
  const out: UpsertContactInput = {};
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!isInputField(field) || !field.ghl) continue;
      const v = values[field.id];
      if (typeof v === "string" && v.trim()) out[field.ghl.standard] = v.trim();
    }
  }
  return out;
}

export function portalCustomFields(
  app: Pick<Application, "id" | "reference" | "status">,
  fields: GhlCustomField[],
): { id: string; field_value: string }[] {
  const wanted: [string, string][] = [
    [PORTAL_FIELDS.reference, app.reference],
    [PORTAL_FIELDS.status, STATUSES[app.status].label],
    [PORTAL_FIELDS.link, adminUrl(app)],
  ];
  return wanted.flatMap(([name, value]) => {
    const f = findField(fields, name);
    return f ? [{ id: f.id, field_value: value }] : [];
  });
}

/** New submission → create/update the contact, tag it, and leave a short note with the link. */
export async function syncNewApplication(form: FormDefinition, app: Application): Promise<{ contactId: string; missingFields: string[] }> {
  const fields = await listCustomFields();
  const custom = portalCustomFields(app, fields);
  const missingFields = Object.values(PORTAL_FIELDS).filter((n) => !findField(fields, n));

  const { contact } = await upsertContact({
    ...standardContactFields(form, app.values),
    source: form.source,
    tags: [...form.tags, statusTag(app.status)],
    customFields: custom,
  });

  await addContactNote(
    contact.id,
    [
      `📋 New ${form.title} — ${app.reference}`,
      app.businessName ? `Business: ${app.businessName}` : null,
      `Open the full application: ${adminUrl(app)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return { contactId: contact.id, missingFields };
}

/** Status changed in the portal → mirror it on the contact so GHL workflows can react. */
export async function syncStatus(app: Application, previous: ApplicationStatus) {
  if (!app.ghlContactId) return;
  const fields = await listCustomFields();
  await updateContact(app.ghlContactId, { customFields: portalCustomFields(app, fields) });
  await addTags(app.ghlContactId, [statusTag(app.status)]);
  if (previous !== app.status) await removeTags(app.ghlContactId, [statusTag(previous)]);
}
