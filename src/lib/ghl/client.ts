import "server-only";
import { assertLeadAlchemistRequestAllowed } from "@/lib/integrations/no-delete";
import { buildUrl } from "@/lib/integrations/urls";
import { credentials } from "@/lib/integrations/credentials";
import { laAppUrl, laEnv } from "./env";

/**
 * Minimal Lead Alchemist (LeadConnector) API v2 client.
 * Auth: a sub-account (location) Private Integration token — contact endpoints are
 * location-scoped.
 * Docs: https://highlevel.stoplight.io/docs/integrations
 */

// Overridable for local testing against a mock server.
const BASE_URL = laEnv("API_BASE_URL") ?? "https://services.leadconnectorhq.com";
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

/** The connection in effect: Admin → Settings → Integrations, else LA_API_TOKEN / LA_LOCATION_ID in Vercel. */
export async function ghlConfig() {
  const c = await credentials();
  const token = clean(c.laApiToken);
  const locationId = clean(c.laLocationId);
  if (!token || !locationId) return null;
  return { token, locationId };
}

/** True when Lead Alchemist refused the request for lack of permission (a missing token scope). */
export const isScopeError = (err: unknown) => err instanceof GhlError && (err.status === 401 || err.status === 403);

const COMPANY_PATHS = /^\/(businesses\b|contacts\/bulk\/business\b)/;

/** Staff-readable: a 401/403 on Companies almost always means the token lacks the Businesses scopes. */
export function leadAlchemistErrorMessage(method: string, path: string, status: number) {
  const where = path.split("?")[0];
  if ((status === 401 || status === 403) && COMPANY_PATHS.test(path))
    return `Lead Alchemist won't let AIS Connect use Companies (${status}): the token is missing the Companies scopes. In Lead Alchemist, open Settings → Private Integrations, edit AIS Connect's integration, add the two Companies scopes (listed as businesses.readonly and businesses.write), and save. If it shows a new token, paste it in Admin → Settings → Integrations.`;
  if (status === 401 || status === 403)
    return `Lead Alchemist refused ${method} ${where} (${status}): the token is invalid or missing a scope. Check it in Admin → Settings → Integrations (Test connection).`;
  return `Lead Alchemist ${method} ${where} failed: ${status}`;
}

async function ghlFetch<T>(path: string, init: RequestInit & { next?: { revalidate?: number } } = {}): Promise<T> {
  assertLeadAlchemistRequestAllowed(init.method, path);
  const cfg = await ghlConfig();
  if (!cfg) throw new GhlError("Lead Alchemist isn't connected: add the token and location ID in Admin → Settings → Integrations", 500, null);

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
  if (!res.ok) throw new GhlError(leadAlchemistErrorMessage(init.method ?? "GET", path, res.status), res.status, body);
  return body as T;
}

/** Contact (or opportunity) custom fields for the location. Cached for 10 minutes. */
export async function listCustomFields(model: "contact" | "opportunity" = "contact"): Promise<GhlCustomField[]> {
  const { locationId } = (await ghlConfig())!;
  const data = await ghlFetch<{ customFields: GhlCustomField[] }>(
    `/locations/${locationId}/customFields?model=${model}`,
    { next: { revalidate: 600 } },
  );
  return data.customFields ?? [];
}

/** Create a text custom field (needs the "Edit Custom Fields" scope on the token). */
export async function createCustomField(name: string, model: "contact" | "opportunity"): Promise<GhlCustomField> {
  const { locationId } = (await ghlConfig())!;
  const data = await ghlFetch<{ customField: GhlCustomField }>(`/locations/${locationId}/customFields`, {
    method: "POST",
    body: JSON.stringify({ name, dataType: "TEXT", model }),
    cache: "no-store",
  });
  if (!data?.customField?.id) throw new Error(`Lead Alchemist didn't return the new custom field "${name}"`);
  return data.customField;
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
  const { locationId } = (await ghlConfig())!;
  return ghlFetch<{ new: boolean; contact: { id: string } }>("/contacts/upsert", {
    method: "POST",
    body: JSON.stringify({ ...input, locationId }),
    cache: "no-store",
  });
}

/**
 * Create a new contact even when one with this email or phone exists (staff said the existing one
 * is someone else). Lead Alchemist may still refuse a duplicate if the location doesn't allow them.
 */
export async function createContact(input: UpsertContactInput) {
  const { locationId } = (await ghlConfig())!;
  return ghlFetch<{ contact: { id: string } }>("/contacts/", {
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
  phone?: string | null;
  /** The Lead Alchemist Company the contact belongs to (a contact has at most one). */
  businessId?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

/** The Lead Alchemist contact with this email, if any (Lead Alchemist's own duplicate lookup). */
export async function findContactByEmail(email: string): Promise<GhlContact | null> {
  const { locationId } = (await ghlConfig())!;
  const q = new URLSearchParams({ locationId, email });
  const data = await ghlFetch<{ contact?: GhlContact | null }>(`/contacts/search/duplicate?${q}`, { cache: "no-store" });
  return data.contact ?? null;
}

/** The Lead Alchemist contact with this phone number, if any (Lead Alchemist's own duplicate lookup). */
export async function findContactByPhone(phone: string): Promise<GhlContact | null> {
  const { locationId } = (await ghlConfig())!;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  const number = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  const q = new URLSearchParams({ locationId, number });
  const data = await ghlFetch<{ contact?: GhlContact | null }>(`/contacts/search/duplicate?${q}`, { cache: "no-store" });
  return data.contact ?? null;
}

/** Contacts matching a name, email or phone (Lead Alchemist's search), newest first. */
export async function searchContacts({ query, limit = 10 }: { query: string; limit?: number }): Promise<GhlContact[]> {
  const { locationId } = (await ghlConfig())!;
  const data = await ghlFetch<{ contacts?: GhlContact[] }>("/contacts/search", {
    method: "POST",
    body: JSON.stringify({ locationId, pageLimit: Math.min(Math.max(limit, 1), 100), query }),
    cache: "no-store",
  });
  return data.contacts ?? [];
}

/**
 * One page of every contact in the sub-account (100 at a time), for the contacts directory.
 * Pass the previous page's `next` to continue; `next` is null on the last page.
 */
export async function listContactsPage(after: unknown[] | null): Promise<{ contacts: GhlContact[]; total: number | null; next: unknown[] | null }> {
  const { locationId } = (await ghlConfig())!;
  const data = await ghlFetch<{ contacts?: (GhlContact & { searchAfter?: unknown[] })[]; total?: number }>("/contacts/search", {
    method: "POST",
    body: JSON.stringify({ locationId, pageLimit: 100, ...(after ? { searchAfter: after } : { page: 1 }), sort: [{ field: "dateAdded", direction: "asc" }] }),
    cache: "no-store",
  });
  const contacts = data.contacts ?? [];
  const last = contacts.at(-1)?.searchAfter;
  return { contacts, total: data.total ?? null, next: contacts.length === 100 && Array.isArray(last) ? last : null };
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

/** Where staff open a contact in Lead Alchemist (https://app.leadalchemist.io unless LA_APP_URL says otherwise). */
export async function contactUrl(contactId: string) {
  const cfg = await ghlConfig();
  const host = laAppUrl();
  return cfg ? buildUrl("ghlContact", { ghl: host, locationId: cfg.locationId, id: contactId }) : null;
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
  const { locationId } = (await ghlConfig())!;
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
  const { locationId } = (await ghlConfig())!;
  const q = new URLSearchParams({ location_id: locationId, contact_id: contactId, pipeline_id: pipelineId, status: "open" });
  const data = await ghlFetch<{ opportunities?: GhlOpportunity[] }>(`/opportunities/search?${q}`, { cache: "no-store" });
  return (data.opportunities ?? [])
    .filter((o) => (!o.status || o.status === "open") && (!o.pipelineId || o.pipelineId === pipelineId))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export interface GhlPipeline {
  id: string;
  name: string;
  /** Lead Alchemist can omit this for an empty pipeline. */
  stages?: { id: string; name: string }[];
}

export async function listPipelines(): Promise<GhlPipeline[]> {
  const { locationId } = (await ghlConfig())!;
  const data = await ghlFetch<{ pipelines: GhlPipeline[] }>(`/opportunities/pipelines?locationId=${locationId}`, {
    cache: "no-store",
  });
  return data.pipelines ?? [];
}

// ── Companies (the API calls them "businesses") ─────────────────────
// Scopes: businesses.readonly, businesses.write (and contacts.write to attach contacts).

export interface GhlBusiness {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  description?: string | null;
}

export type BusinessInput = Omit<GhlBusiness, "id">;

/** Every Company in the sub-account (paged 100 at a time). */
export async function listBusinesses(max = 10_000): Promise<GhlBusiness[]> {
  const { locationId } = (await ghlConfig())!;
  const all: GhlBusiness[] = [];
  for (let skip = 0; skip < max; skip += 100) {
    const q = new URLSearchParams({ locationId, limit: "100", skip: String(skip) });
    const data = await ghlFetch<{ businesses?: GhlBusiness[] }>(`/businesses/?${q}`, { cache: "no-store" });
    const page = data.businesses ?? [];
    all.push(...page);
    if (page.length < 100) break;
  }
  return all;
}

/** One Company, or null if it's gone. */
export async function getBusiness(id: string): Promise<GhlBusiness | null> {
  try {
    const data = await ghlFetch<{ business?: GhlBusiness }>(`/businesses/${encodeURIComponent(id)}`, { cache: "no-store" });
    return data.business ?? null;
  } catch (err) {
    if (err instanceof GhlError && err.status === 404) return null;
    throw err;
  }
}

const businessBody = (input: Partial<BusinessInput>) =>
  Object.fromEntries(Object.entries(input).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, (v as string).trim()]));

export async function createBusiness(input: BusinessInput): Promise<GhlBusiness> {
  const { locationId } = (await ghlConfig())!;
  // The API spells the response key "buiseness".
  const data = await ghlFetch<{ buiseness?: GhlBusiness; business?: GhlBusiness }>("/businesses/", {
    method: "POST",
    body: JSON.stringify({ ...businessBody(input), name: input.name, locationId }),
    cache: "no-store",
  });
  const created = data.buiseness ?? data.business;
  if (!created?.id) throw new Error("Lead Alchemist didn't return the new Company");
  return created;
}

export async function updateBusiness(id: string, input: Partial<BusinessInput>) {
  return ghlFetch(`/businesses/${id}`, { method: "PUT", body: JSON.stringify(businessBody(input)), cache: "no-store" });
}

/** Put contacts in a Company (up to 50 per call; a contact can only be in one Company). */
export async function addContactsToBusiness(contactIds: string[], businessId: string) {
  const { locationId } = (await ghlConfig())!;
  for (let i = 0; i < contactIds.length; i += 50) {
    await ghlFetch("/contacts/bulk/business", {
      method: "POST",
      body: JSON.stringify({ locationId, ids: contactIds.slice(i, i + 50), businessId }),
      cache: "no-store",
    });
  }
}
