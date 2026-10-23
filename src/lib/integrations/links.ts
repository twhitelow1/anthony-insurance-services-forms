import "server-only";
import { getSettings } from "@/lib/settings";
import { linksFor, type LinkBases, type Links } from "./urls";

export const DEFAULT_GHL_APP_URL = "https://app.gohighlevel.com";

/** The configured bases: Salesforce from Vercel, the Lead Alchemist web address from Admin → Settings (else GHL_APP_URL). */
export async function linkBases(): Promise<LinkBases> {
  const s = await getSettings().catch(() => null);
  return {
    salesforce: process.env.SALESFORCE_LIGHTNING_URL ?? null,
    ghl: s?.ghlAppUrl || process.env.GHL_APP_URL || DEFAULT_GHL_APP_URL,
    ghlLocationId: process.env.GHL_LOCATION_ID?.trim() || null,
    app: process.env.APP_URL ?? null,
  };
}

export async function links(): Promise<Links> {
  return linksFor(await linkBases());
}
