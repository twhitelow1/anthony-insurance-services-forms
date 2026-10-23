import "server-only";

/**
 * Salesforce connection, from Vercel environment variables only (never the database or repo):
 * - SALESFORCE_LOGIN_URL     the org's My Domain URL (or a sandbox's), e.g. https://anthony.my.salesforce.com
 * - SALESFORCE_CLIENT_ID     External Client App / Connected App consumer key
 * - SALESFORCE_CLIENT_SECRET its consumer secret
 * - SALESFORCE_LIGHTNING_URL where staff open records, e.g. https://dg0000000i7rimaa.lightning.force.com
 * - SALESFORCE_API_VERSION   optional, default v62.0
 * Whether the sync runs, and dry run, are in Admin → Settings (see settings.ts).
 */
export const DEFAULT_API_VERSION = "v62.0";

const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

export function salesforceConfig(env: NodeJS.ProcessEnv = process.env) {
  const loginUrl = clean(env.SALESFORCE_LOGIN_URL).replace(/\/+$/, "");
  const clientId = clean(env.SALESFORCE_CLIENT_ID);
  const clientSecret = clean(env.SALESFORCE_CLIENT_SECRET);
  if (!loginUrl || !clientId || !clientSecret) return null;
  const v = clean(env.SALESFORCE_API_VERSION) || DEFAULT_API_VERSION;
  return {
    loginUrl,
    clientId,
    clientSecret,
    apiVersion: v.startsWith("v") ? v : `v${v}`,
    lightningUrl: clean(env.SALESFORCE_LIGHTNING_URL).replace(/\/+$/, "") || null,
  };
}
export type SalesforceConfig = NonNullable<ReturnType<typeof salesforceConfig>>;
