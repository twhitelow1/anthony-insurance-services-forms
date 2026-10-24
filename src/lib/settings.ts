import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isStatus, type ApplicationStatus } from "@/lib/applications/status";
import { laEnv } from "@/lib/ghl/env";

/**
 * Day-to-day settings staff change in Admin → Settings. Each one is stored in
 * the app_settings table; when it isn't set there, the matching Vercel
 * environment variable is used. Secrets (API keys, SESSION_SECRET, the
 * database URL) stay in Vercel only.
 */
export interface Settings {
  /** Who can sign in to /admin. STAFF_EMAILS in Vercel always counts too (so nobody can lock everyone out). */
  staffEmails: string[];
  /** With no staff list at all, any address at these domains is staff. */
  staffEmailDomains: string[];
  /** Staff emailed about every new application. */
  notifyEmails: string[];
  /** Sender, e.g. "Anthony Insurance Services <applications@anthonyinsuranceservices.com>". Domain must be verified in Resend. */
  mailFrom: string;
  mailReplyTo: string;
  /** Pre-filled To: on carrier submission drafts. */
  carrierEmails: string[];
  /** Lead Alchemist pipeline / stage, by ID or name as shown in Lead Alchemist. */
  ghlPipeline: string;
  ghlPipelineStage: string;
  ghlLeadPipeline: string;
  ghlLeadStage: string;
  /** Portal status → Lead Alchemist stage, moved on status changes. */
  ghlStageMap: Partial<Record<ApplicationStatus, string>>;
  /** Lead Alchemist web address for links (the white-label domain), e.g. https://app.leadalchemist.io. */
  ghlAppUrl: string;
  /** New business Accounts get a Lead Alchemist Company (found by name, else created) and their contacts go in it. */
  ghlCompaniesSync: boolean;
  /** Sync submitted applications to Salesforce. Off until Salesforce is set up and tested. */
  salesforceEnabled: boolean;
  /** Log what would be written to Salesforce without writing. Defaults to on outside production. */
  salesforceDryRun: boolean;
  /** Portal status → Salesforce Opportunity stage (as shown in Salesforce). Unmapped: an open stage is picked automatically. */
  salesforceStageMap: Partial<Record<ApplicationStatus, string>>;
}

export type SettingKey = keyof Settings;
export const DEFAULT_MAIL_FROM = "Anthony Insurance Services <applications@anthonyinsuranceservices.com>";

const list = (v: string | undefined) =>
  (v ?? "")
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);

function parseStageMap(raw: string | undefined, name = "LA_STAGE_IDS"): Partial<Record<ApplicationStatus, string>> {
  try {
    const obj: unknown = JSON.parse(raw || "{}");
    if (!obj || typeof obj !== "object") return {};
    return Object.fromEntries(
      Object.entries(obj).filter(([k, v]) => isStatus(k) && typeof v === "string" && v.trim()),
    ) as Partial<Record<ApplicationStatus, string>>;
  } catch {
    console.warn(`[settings] ${name} is not valid JSON — ignoring`);
    return {};
  }
}

/** SALESFORCE_DRY_RUN=1/0 wins; otherwise dry run everywhere except Vercel production. */
export function defaultDryRun(env: NodeJS.ProcessEnv = process.env) {
  if (env.SALESFORCE_DRY_RUN === "1" || env.SALESFORCE_DRY_RUN === "true") return true;
  if (env.SALESFORCE_DRY_RUN === "0" || env.SALESFORCE_DRY_RUN === "false") return false;
  return env.VERCEL_ENV !== "production";
}

/** The Vercel environment's values, used for anything not set in Admin → Settings. */
export function envSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    staffEmails: list(env.STAFF_EMAILS).map((e) => e.toLowerCase()),
    staffEmailDomains: list(env.STAFF_EMAIL_DOMAINS ?? "anthonyinsuranceservices.com").map((d) => d.toLowerCase()),
    notifyEmails: list(env.NOTIFY_EMAILS),
    mailFrom: env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM,
    mailReplyTo: env.MAIL_REPLY_TO?.trim() ?? "",
    carrierEmails: list(env.CARRIER_EMAIL),
    ghlPipeline: laEnv("PIPELINE_ID", env)?.trim() ?? "",
    ghlPipelineStage: laEnv("PIPELINE_STAGE_ID", env)?.trim() ?? "",
    ghlLeadPipeline: laEnv("LEAD_PIPELINE_ID", env)?.trim() ?? "",
    ghlLeadStage: laEnv("LEAD_STAGE_ID", env)?.trim() ?? "",
    ghlStageMap: parseStageMap(laEnv("STAGE_IDS", env), "LA_STAGE_IDS"),
    ghlAppUrl: laEnv("APP_URL", env)?.trim() ?? "",
    ghlCompaniesSync: laEnv("COMPANIES_SYNC", env) === "1",
    salesforceEnabled: env.SALESFORCE_SYNC_ENABLED === "1",
    salesforceDryRun: defaultDryRun(env),
    salesforceStageMap: parseStageMap(env.SALESFORCE_STAGE_MAP, "SALESFORCE_STAGE_MAP"),
  };
}

// Stored rows are cached briefly so hot paths (every staff page checks the staff list) don't hit the database each time.
let cache: { at: number; rows: Promise<Partial<Settings>> } | null = null;
const TTL_MS = 30_000;

async function loadStored(): Promise<Partial<Settings>> {
  const db = await getDb();
  const rows = await db.select().from(schema.appSettings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<Settings>;
}

/** Values saved in Admin → Settings only (no environment fallback). */
export function storedSettings(): Promise<Partial<Settings>> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), rows: loadStored() };
    cache.rows.catch(() => (cache = null));
  }
  return cache.rows;
}

/** Effective settings: what's saved in Admin → Settings, else the Vercel environment variable. */
export async function getSettings(): Promise<Settings> {
  const env = envSettings();
  const stored = await storedSettings().catch((err) => {
    console.error("[settings] couldn't read app_settings; using environment values", err);
    return {} as Partial<Settings>;
  });
  const merged = { ...env };
  for (const key of Object.keys(env) as SettingKey[]) {
    const v = stored[key];
    if (v === undefined || v === null) continue;
    (merged as Record<SettingKey, unknown>)[key] = v;
  }
  // Admins saved here add to STAFF_EMAILS; they never replace it.
  merged.staffEmails = [...new Set([...env.staffEmails, ...(stored.staffEmails ?? [])])];
  return merged;
}

/** Save settings. A null value clears the saved one, so the Vercel variable applies again. */
export async function saveSettings(patch: { [K in SettingKey]?: Settings[K] | null }, updatedBy: string) {
  const db = await getDb();
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
    } else {
      await db
        .insert(schema.appSettings)
        .values({ key, value, updatedBy })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedBy, updatedAt: new Date() } });
    }
  }
  cache = null;
}
