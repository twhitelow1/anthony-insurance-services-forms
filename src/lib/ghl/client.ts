import "server-only";

/**
 * Minimal GoHighLevel (LeadConnector) API v2 client.
 * Auth: a Private Integration token scoped to the sub-account (location).
 * Docs: https://highlevel.stoplight.io/docs/integrations
 */

// Overridable for local testing against a mock server.
const BASE_URL = process.env.GHL_API_BASE_URL ?? "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";

export interface GhlCustomField {
  id: string;
  name: string;
  fieldKey: string; // e.g. "contact.legal_business_name"
  dataType: string; // TEXT, LARGE_TEXT, SINGLE_OPTIONS, MULTIPLE_OPTIONS, CHECKBOX, RADIO, DATE, NUMERICAL, MONETORY, SIGNATURE, FILE_UPLOAD, ...
  picklistOptions?: string[];
}

export class GhlError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export function ghlConfig() {
  const token = process.env.GHL_API_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) return null;
  return { token, locationId };
}

async function ghlFetch<T>(path: string, init: RequestInit & { next?: { revalidate?: number } } = {}): Promise<T> {
  const cfg = ghlConfig();
  if (!cfg) throw new GhlError("GHL_API_TOKEN and GHL_LOCATION_ID must be set", 500, null);

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Version: API_VERSION,
      Accept: "application/json",
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new GhlError(`GHL ${init.method ?? "GET"} ${path} failed: ${res.status}`, res.status, body);
  return body as T;
}

/** Contact custom fields for the location. Cached for 10 minutes. */
export async function listCustomFields(): Promise<GhlCustomField[]> {
  const { locationId } = ghlConfig()!;
  const data = await ghlFetch<{ customFields: GhlCustomField[] }>(
    `/locations/${locationId}/customFields?model=contact`,
    { next: { revalidate: 600 } },
  );
  return data.customFields ?? [];
}

export interface UpsertContactInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  website?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  companyName?: string;
  source?: string;
  tags?: string[];
  customFields?: { id: string; field_value: string | string[] | number }[];
}

/** Create or update (matched on email/phone per the location's duplicate settings). */
export async function upsertContact(input: UpsertContactInput) {
  const { locationId } = ghlConfig()!;
  return ghlFetch<{ new: boolean; contact: { id: string } }>("/contacts/upsert", {
    method: "POST",
    body: JSON.stringify({ ...input, locationId }),
    cache: "no-store",
  });
}

export async function addContactNote(contactId: string, body: string) {
  return ghlFetch(`/contacts/${contactId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
    cache: "no-store",
  });
}

/**
 * Upload a file (e.g. the signature PNG) into a FILE_UPLOAD / SIGNATURE custom field.
 * GHL expects the multipart field name to be `<customFieldId>_<uuid>`.
 */
export async function uploadCustomFieldFile(contactId: string, fieldId: string, file: Blob, filename: string) {
  const { locationId } = ghlConfig()!;
  const form = new FormData();
  form.append(`${fieldId}_${crypto.randomUUID()}`, file, filename);
  return ghlFetch(`/forms/upload-custom-files?contactId=${contactId}&locationId=${locationId}`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
}
