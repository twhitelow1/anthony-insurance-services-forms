import "server-only";
import { getSettings, storedSettings } from "@/lib/settings";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who counts as staff:
 * - anyone on the admins list (Admin → Settings, plus STAFF_EMAILS in Vercel);
 * - anyone at a domain saved under "Staff email domains" in Admin → Settings;
 * - while no admins are listed at all, anyone at the default domains
 *   (STAFF_EMAIL_DOMAINS, default anthonyinsuranceservices.com), so the first admin can get in.
 */
export async function isStaffEmail(rawEmail: string): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return false;
  const domain = email.split("@")[1];
  const [{ staffEmails, staffEmailDomains }, stored] = await Promise.all([getSettings(), storedSettings()]);
  if (staffEmails.includes(email)) return true;
  if ((stored.staffEmailDomains ?? []).map((d) => d.toLowerCase()).includes(domain)) return true;
  return staffEmails.length === 0 && staffEmailDomains.includes(domain);
}
