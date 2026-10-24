import "server-only";
import { credentials, type IntegrationCredentials } from "@/lib/integrations/credentials";

/**
 * The Salesforce connection: entered in Admin → Settings → Integrations (stored encrypted),
 * else the Vercel variables
 * - SALESFORCE_LOGIN_URL     the org's My Domain URL (or a sandbox's), e.g. https://anthony.my.salesforce.com
 * - SALESFORCE_CLIENT_ID     External Client App / Connected App consumer key
 * - SALESFORCE_CLIENT_SECRET its consumer secret
 * - SALESFORCE_LIGHTNING_URL where staff open records, e.g. https://dg0000000i7rimaa.lightning.force.com
 * - SALESFORCE_API_VERSION   optional, default v62.0
 * Whether the sync runs, and dry run, are in Admin → Settings (see settings.ts).
 */
export const DEFAULT_API_VERSION = "v62.0";

const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

export function salesforceConfigFrom(c: IntegrationCredentials) {
  const loginUrl = clean(c.salesforceLoginUrl).replace(/\/+$/, "");
  const clientId = clean(c.salesforceClientId);
  const clientSecret = clean(c.salesforceClientSecret);
  if (!loginUrl || !clientId || !clientSecret) return null;
  const v = clean(c.salesforceApiVersion) || DEFAULT_API_VERSION;
  return {
    loginUrl,
    clientId,
    clientSecret,
    apiVersion: v.startsWith("v") ? v : `v${v}`,
    lightningUrl: clean(c.salesforceLightningUrl).replace(/\/+$/, "") || null,
  };
}

/** From Vercel variables only (tests and scripts). */
export function salesforceConfigFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return salesforceConfigFrom({
    salesforceLoginUrl: env.SALESFORCE_LOGIN_URL,
    salesforceClientId: env.SALESFORCE_CLIENT_ID,
    salesforceClientSecret: env.SALESFORCE_CLIENT_SECRET,
    salesforceLightningUrl: env.SALESFORCE_LIGHTNING_URL,
    salesforceApiVersion: env.SALESFORCE_API_VERSION,
  });
}

/** The connection in effect (dashboard, else Vercel), or null when it isn't set up. */
export async function salesforceConfig() {
  return salesforceConfigFrom(await credentials());
}
export type SalesforceConfig = NonNullable<ReturnType<typeof salesforceConfigFrom>>;
