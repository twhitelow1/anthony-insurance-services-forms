"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { openAccess, requireStaff } from "@/lib/auth/session";
import { isStaffEmail } from "@/lib/auth/staff";
import { STATUS_KEYS, type ApplicationStatus } from "@/lib/applications/status";
import { emailLayout, sendMail } from "@/lib/mail";
import { getSettings, saveSettings, storedSettings, type Settings } from "@/lib/settings";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
// "Name <user@domain>" or a bare address.
const FROM_RE = /^(?:[^<>@\r\n]+<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;

const back = (q: string) => redirect(`/admin/settings?${q}`);
const fail = (message: string): never => back(`error=${encodeURIComponent(message)}`);

const str = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim().slice(0, 500);

/** A list field: emails or domains, one per line or comma-separated. Empty → null (use the Vercel value). */
function listField(fd: FormData, name: string, label: string, re: RegExp, lower = true): string[] | null {
  const items = str(fd, name)
    .split(/[,\n;]/)
    .map((s) => (lower ? s.trim().toLowerCase() : s.trim()))
    .filter(Boolean);
  const bad = items.filter((i) => !re.test(i));
  if (bad.length) fail(`${label}: "${bad[0]}" doesn't look right.`);
  return items.length ? [...new Set(items)] : null;
}

export async function saveSettingsAction(formData: FormData) {
  const staff = await requireStaff("/admin/settings");

  const mailFrom = str(formData, "mailFrom");
  if (mailFrom && !FROM_RE.test(mailFrom)) fail('Send from must look like "Anthony Insurance Services <applications@anthonyinsuranceservices.com>".');
  const mailReplyTo = str(formData, "mailReplyTo").toLowerCase();
  if (mailReplyTo && !EMAIL_RE.test(mailReplyTo)) fail("Reply-to must be one email address.");

  const stageMap: Partial<Record<ApplicationStatus, string>> = {};
  for (const k of STATUS_KEYS) {
    const v = str(formData, `stage_${k}`);
    if (v) stageMap[k] = v;
  }

  const patch: { [K in keyof Settings]?: Settings[K] | null } = {
    staffEmails: listField(formData, "staffEmails", "Admins", EMAIL_RE),
    staffEmailDomains: listField(formData, "staffEmailDomains", "Staff email domains", DOMAIN_RE),
    notifyEmails: listField(formData, "notifyEmails", "New-application alerts", EMAIL_RE),
    carrierEmails: listField(formData, "carrierEmails", "Carrier email", EMAIL_RE),
    mailFrom: mailFrom || null,
    mailReplyTo: mailReplyTo || null,
    ghlPipeline: str(formData, "ghlPipeline") || null,
    ghlPipelineStage: str(formData, "ghlPipelineStage") || null,
    ghlLeadPipeline: str(formData, "ghlLeadPipeline") || null,
    ghlLeadStage: str(formData, "ghlLeadStage") || null,
    ghlStageMap: Object.keys(stageMap).length ? stageMap : null,
  };
  if (patch.ghlLeadStage && !patch.ghlLeadPipeline) fail("Pick the lead pipeline the lead stage belongs to.");

  const before = await storedSettings();
  await saveSettings(patch, `staff:${staff.email}`);

  // Never let someone save themselves out of the admin.
  if (!openAccess() && !(await isStaffEmail(staff.email))) {
    await saveSettings({ staffEmails: before.staffEmails ?? null, staffEmailDomains: before.staffEmailDomains ?? null }, `staff:${staff.email}`);
    fail(`That would remove your own access (${staff.email}). Add yourself to Admins, then save again.`);
  }

  console.info(`[settings] updated by ${staff.email}`);
  revalidatePath("/admin", "layout");
  back("saved=1");
}

/** Send a test email to the signed-in staff member using the current sender settings. */
export async function sendTestEmailAction() {
  const staff = await requireStaff("/admin/settings");
  if (openAccess()) fail("Sign-in is off (OPEN_ACCESS), so there's no email address to send the test to.");
  const { mailFrom } = await getSettings();
  try {
    await sendMail({
      to: staff.email,
      subject: "Test email — Anthony Insurance applications",
      html: emailLayout({
        heading: "Email is working",
        paragraphs: [`This test was sent from ${mailFrom.replace(/[<>]/g, "")} by the applications admin.`],
      }),
    });
  } catch (err) {
    fail(`The test email failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  back(`sent=${encodeURIComponent(staff.email)}`);
}
