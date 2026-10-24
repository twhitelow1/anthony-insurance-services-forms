import "server-only";
import { getSettings } from "@/lib/settings";
import { linksFor, type LinkBases, type Links } from "./urls";
import { laAppUrl } from "@/lib/ghl/env";
import { credentials } from "@/lib/integrations/credentials";

export { LA_DEFAULT_APP_URL as DEFAULT_GHL_APP_URL } from "@/lib/ghl/env";

/** The configured bases: Salesforce from Vercel, the Lead Alchemist web address from Admin → Settings (else LA_APP_URL, else https://app.leadalchemist.io). */
export async function linkBases(): Promise<LinkBases> {
  const s = await getSettings().catch(() => null);
  const c = await credentials();
  return {
    salesforce: c.salesforceLightningUrl || null,
    ghl: (s?.ghlAppUrl || laAppUrl()).replace(/\/$/, ""),
    ghlLocationId: c.laLocationId || null,
    app: process.env.APP_URL ?? null,
  };
}

export async function links(): Promise<Links> {
  return linksFor(await linkBases());
}
