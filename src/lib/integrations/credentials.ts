import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Connection keys for Salesforce and Lead Alchemist, entered in Admin → Settings → Integrations.
 *
 * - Stored in app_settings as one AES-256-GCM encrypted blob. The key is INTEGRATIONS_KEY
 *   (32+ characters) when set in Vercel, else derived from SESSION_SECRET. Changing that
 *   key makes the stored values unreadable: the dashboard says so and they're re-entered.
 * - Secrets are write-only: the dashboard shows whether one is saved, never its value.
 * - A value saved here takes precedence; otherwise the Vercel variable is used, so existing
 *   deployments keep working unchanged.
 */
export interface IntegrationCredentials {
  salesforceLoginUrl?: string;
  salesforceClientId?: string;
  salesforceClientSecret?: string;
  salesforceLightningUrl?: string;
  salesforceApiVersion?: string;
  laApiToken?: string;
  laLocationId?: string;
}
export type CredentialKey = keyof IntegrationCredentials;

/** Values never shown back on the dashboard. */
export const SECRET_KEYS: CredentialKey[] = ["salesforceClientSecret", "laApiToken"];

/** The Vercel variable each value falls back to (LA_ names also accept the older GHL_ ones). */
export const ENV_FALLBACK: Record<CredentialKey, string[]> = {
  salesforceLoginUrl: ["SALESFORCE_LOGIN_URL"],
  salesforceClientId: ["SALESFORCE_CLIENT_ID"],
  salesforceClientSecret: ["SALESFORCE_CLIENT_SECRET"],
  salesforceLightningUrl: ["SALESFORCE_LIGHTNING_URL"],
  salesforceApiVersion: ["SALESFORCE_API_VERSION"],
  laApiToken: ["LA_API_TOKEN", "GHL_API_TOKEN"],
  laLocationId: ["LA_LOCATION_ID", "GHL_LOCATION_ID"],
};

const STORE_KEY = "integration_credentials";
const TTL_MS = 30_000;

interface Stored {
  v: 1;
  iv: string;
  tag: string;
  data: string;
  /** Who saved each value and when (no values). */
  meta: Partial<Record<CredentialKey, { by: string; at: string }>>;
}

function encryptionKey(): Buffer {
  const own = process.env.INTEGRATIONS_KEY?.trim();
  const base = own && own.length >= 32 ? own : process.env.SESSION_SECRET;
  if (!base || base.length < 32) throw new Error("Set SESSION_SECRET (or INTEGRATIONS_KEY) in Vercel before saving connection keys.");
  return Buffer.from(hkdfSync("sha256", base, "ais-integrations", "integration-credentials-v1", 32));
}

export function encrypt(values: IntegrationCredentials): Pick<Stored, "iv" | "tag" | "data"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export function decrypt(stored: Pick<Stored, "iv" | "tag" | "data">): IntegrationCredentials {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(stored.iv, "base64"));
  decipher.setAuthTag(Buffer.from(stored.tag, "base64"));
  const text = Buffer.concat([decipher.update(Buffer.from(stored.data, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(text) as IntegrationCredentials;
}

export interface LoadedCredentials {
  values: IntegrationCredentials;
  meta: Stored["meta"];
  /** Saved values exist but couldn't be decrypted (the key changed). */
  unreadable: boolean;
}

let cache: { at: number; value: Promise<LoadedCredentials> } | null = null;

async function loadStored(): Promise<LoadedCredentials> {
  try {
    const db = await getDb();
    const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, STORE_KEY)).limit(1);
    const stored = row?.value as Stored | undefined;
    if (!stored?.data) return { values: {}, meta: {}, unreadable: false };
    try {
      return { values: decrypt(stored), meta: stored.meta ?? {}, unreadable: false };
    } catch {
      console.error("[integrations] saved connection keys can't be decrypted (INTEGRATIONS_KEY or SESSION_SECRET changed); using Vercel values");
      return { values: {}, meta: stored.meta ?? {}, unreadable: true };
    }
  } catch (err) {
    console.error("[integrations] couldn't read saved connection keys; using Vercel values", err instanceof Error ? err.message : err);
    return { values: {}, meta: {}, unreadable: false };
  }
}

export function storedCredentials(): Promise<LoadedCredentials> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), value: loadStored() };
    cache.value.catch(() => (cache = null));
  }
  return cache.value;
}

const clean = (v: string | undefined | null) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

export function envValue(key: CredentialKey, env: NodeJS.ProcessEnv = process.env): string {
  for (const name of ENV_FALLBACK[key]) {
    const v = clean(env[name]);
    if (v) return v;
  }
  return "";
}

/** Every value in effect: saved on the dashboard, else Vercel. */
export async function credentials(): Promise<Required<IntegrationCredentials>> {
  const { values } = await storedCredentials();
  const out = {} as Required<IntegrationCredentials>;
  for (const key of Object.keys(ENV_FALLBACK) as CredentialKey[]) out[key] = clean(values[key]) || envValue(key);
  return out;
}

export type CredentialSource = "dashboard" | "vercel" | "missing";

/** For the dashboard: where each value comes from, and the non-secret values. Secrets are never returned. */
export async function credentialStatus() {
  const { values, meta, unreadable } = await storedCredentials();
  const status = {} as Record<CredentialKey, { source: CredentialSource; value: string | null; savedBy?: string; savedAt?: string }>;
  for (const key of Object.keys(ENV_FALLBACK) as CredentialKey[]) {
    const saved = clean(values[key]);
    const env = envValue(key);
    const source: CredentialSource = saved ? "dashboard" : env ? "vercel" : "missing";
    const value = SECRET_KEYS.includes(key) ? null : saved || env || null;
    status[key] = { source, value, savedBy: saved ? meta[key]?.by : undefined, savedAt: saved ? meta[key]?.at : undefined };
  }
  return { status, unreadable };
}

/**
 * Save values from the dashboard. An empty string for a secret keeps the saved one (the field is
 * write-only); null removes a saved value so the Vercel variable applies again.
 */
export async function saveCredentials(patch: { [K in CredentialKey]?: string | null }, actor: string) {
  const current = await loadStored();
  const values: IntegrationCredentials = current.unreadable ? {} : { ...current.values };
  const meta = { ...current.meta };
  const now = new Date().toISOString();
  for (const [k, v] of Object.entries(patch) as [CredentialKey, string | null | undefined][]) {
    if (v === undefined) continue;
    if (v === null) {
      delete values[k];
      delete meta[k];
      continue;
    }
    const val = clean(v);
    if (!val) continue;
    values[k] = val;
    meta[k] = { by: actor, at: now };
  }
  const stored: Stored = { v: 1, ...encrypt(values), meta };
  const db = await getDb();
  await db
    .insert(schema.appSettings)
    .values({ key: STORE_KEY, value: stored, updatedBy: actor })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: stored, updatedBy: actor, updatedAt: new Date() } });
  cache = null;
}

/** Tests and the save action: forget the cached copy. */
export function clearCredentialCache() {
  cache = null;
}
