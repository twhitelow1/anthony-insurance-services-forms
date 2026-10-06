import "server-only";

/**
 * Minimal GoHighLevel (LeadConnector) API v2 client.
 * Auth: a sub-account (location) Private Integration token — contact endpoints are
 * location-scoped.
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

/** Env value without stray whitespace, quotes or a pasted "Bearer " prefix. */
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();

export function ghlConfig() {
  const token = clean(process.env.GHL_API_TOKEN);
  const locationId = clean(process.env.GHL_LOCATION_ID);
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

/** Contact (or opportunity) custom fields for the location. Cached for 10 minutes. */
export async function listCustomFields(model: "contact" | "opportunity" = "contact"): Promise<GhlCustomField[]> {
  const { locationId } = ghlConfig()!;
  const data = await ghlFetch<{ customFields: GhlCustomField[] }>(
    `/locations/${locationId}/customFields?model=${model}`,
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

export interface GhlContact {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
  companyName?: string | null;
}

/** The GHL contact with this email, if any (GHL's own duplicate lookup). */
export async function findContactByEmail(email: string): Promise<GhlContact | null> {
  const { locationId } = ghlConfig()!;
  const q = new URLSearchParams({ locationId, email });
  const data = await ghlFetch<{ contact?: GhlContact | null }>(`/contacts/search/duplicate?${q}`, { cache: "no-store" });
  return data.contact ?? null;
}

/** A contact by ID, or null if it was deleted (or merged away). */
export async function getContact(id: string): Promise<GhlContact | null> {
  try {
    const data = await ghlFetch<{ contact?: GhlContact }>(`/contacts/${id}`, { cache: "no-store" });
    return data.contact ?? null;
  } catch (err) {
    if (err instanceof GhlError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

/** Where staff open a contact in GHL. GHL_APP_URL overrides the host for a white-label domain. */
export function contactUrl(contactId: string) {
  const cfg = ghlConfig();
  const host = (process.env.GHL_APP_URL || "https://app.gohighlevel.com").replace(/\/$/, "");
  return cfg ? `${host}/v2/location/${cfg.locationId}/contacts/detail/${contactId}` : null;
}

export async function addContactNote(contactId: string, body: string) {
  return ghlFetch(`/contacts/${contactId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
    cache: "no-store",
  });
}

export async function updateContact(contactId: string, input: Omit<UpsertContactInput, "tags" | "source">) {
  return ghlFetch(`/contacts/${contactId}`, { method: "PUT", body: JSON.stringify(input), cache: "no-store" });
}

export async function addTags(contactId: string, tags: string[]) {
  return ghlFetch(`/contacts/${contactId}/tags`, { method: "POST", body: JSON.stringify({ tags }), cache: "no-store" });
}

export async function removeTags(contactId: string, tags: string[]) {
  return ghlFetch(`/contacts/${contactId}/tags`, { method: "DELETE", body: JSON.stringify({ tags }), cache: "no-store" });
}

export interface OpportunityInput {
  pipelineId: string;
  pipelineStageId: string;
  name: string;
  contactId: string;
  status?: "open" | "won" | "lost" | "abandoned";
  source?: string;
  monetaryValue?: number;
  customFields?: { id: string; field_value: string }[];
}

export async function createOpportunity(input: OpportunityInput) {
  const { locationId } = ghlConfig()!;
  return ghlFetch<{ opportunity: { id: string } }>("/opportunities/", {
    method: "POST",
    body: JSON.stringify({ status: "open", ...input, locationId }),
    cache: "no-store",
  });
}

export async function updateOpportunity(
  id: string,
  input: Partial<Pick<OpportunityInput, "pipelineId" | "pipelineStageId" | "status" | "name" | "customFields">>,
) {
  return ghlFetch(`/opportunities/${id}`, { method: "PUT", body: JSON.stringify(input), cache: "no-store" });
}

export interface GhlOpportunity {
  id: string;
  contactId?: string;
  name?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: string;
  createdAt?: string;
}

/** Open opportunities for a contact in a pipeline, newest first. */
export async function findOpenOpportunities(contactId: string, pipelineId: string): Promise<GhlOpportunity[]> {
  const { locationId } = ghlConfig()!;
  const q = new URLSearchParams({ location_id: locationId, contact_id: contactId, pipeline_id: pipelineId, status: "open" });
  const data = await ghlFetch<{ opportunities?: GhlOpportunity[] }>(`/opportunities/search?${q}`, { cache: "no-store" });
  return (data.opportunities ?? [])
    .filter((o) => (!o.status || o.status === "open") && (!o.pipelineId || o.pipelineId === pipelineId))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export interface GhlPipeline {
  id: string;
  name: string;
  /** GHL can omit this for an empty pipeline. */
  stages?: { id: string; name: string }[];
}

export async function listPipelines(): Promise<GhlPipeline[]> {
  const { locationId } = ghlConfig()!;
  const data = await ghlFetch<{ pipelines: GhlPipeline[] }>(`/opportunities/pipelines?locationId=${locationId}`, {
    cache: "no-store",
  });
  return data.pipelines ?? [];
}
