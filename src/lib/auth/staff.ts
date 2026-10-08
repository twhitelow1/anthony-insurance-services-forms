import "server-only";
import { getSettings } from "@/lib/settings";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Who counts as staff: the admins listed in Admin → Settings plus STAFF_EMAILS
 * in Vercel, if either list has anyone; otherwise any address at one of the
 * staff email domains (default anthonyinsuranceservices.com).
 */
export async function isStaffEmail(rawEmail: string): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return false;
  const { staffEmails, staffEmailDomains } = await getSettings();
  if (staffEmails.length) return staffEmails.includes(email);
  return staffEmailDomains.includes(email.split("@")[1]);
}
