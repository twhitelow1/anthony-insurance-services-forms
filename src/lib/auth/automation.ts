import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Calls from Vercel Cron and the backfill CLI carry "Authorization: Bearer <CRON_SECRET>"
 * (Vercel sends CRON_SECRET automatically to cron routes). Off when CRON_SECRET isn't set.
 */
export function isAutomationRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
