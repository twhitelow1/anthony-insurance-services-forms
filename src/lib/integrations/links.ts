import "server-only";
import { getSettings } from "@/lib/settings";
import { linksFor, type LinkBases, type Links } from "./urls";
import { laAppUrl, laEnv } from "@/lib/ghl/env";

export { LA_DEFAULT_APP_URL as DEFAULT_GHL_APP_URL } from "@/lib/ghl/env";

/** The configured bases: Salesforce from Vercel, the Lead Alchemist web address from Admin → Settings (else LA_APP_URL, else https://app.leadalchemist.io). */
export async function linkBases(): Promise<LinkBases> {
  const s = await getSettings().catch(() => null);
  return {
    salesforce: process.env.SALESFORCE_LIGHTNING_URL ?? null,
    ghl: (s?.ghlAppUrl || laAppUrl()).replace(/\/$/, ""),
    ghlLocationId: laEnv("LOCATION_ID")?.trim() || null,
    app: process.env.APP_URL ?? null,
  };
}

export async function links(): Promise<Links> {
  return linksFor(await linkBases());
}
