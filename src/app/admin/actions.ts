"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getForm } from "@/forms";
import { getSession, requireStaff, setPortalViewAs } from "@/lib/auth/session";
import {
  addStaffNote,
  deleteApplication,
  getApplication,
  linkApplicantGhl,
  normalizeEmail,
  setStatus,
  unlinkedApplicantEmails,
} from "@/lib/applications/repo";
import { findContactByEmail, getContact, ghlConfig } from "@/lib/ghl/client";
import { makePdf, onStatusChanged, pushToGhl, runAiReview } from "@/lib/applications/pipeline";
import { aiClient } from "@/lib/ai/client";
import { type AssistantReply, type ChatTurn, askAssistant } from "@/lib/ai/assistant";
import { isStatus } from "@/lib/applications/status";

// Every action re-checks the staff session: server actions are reachable by direct POST.

export async function updateStatusAction(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const status = formData.get("status");
  const note = String(formData.get("note") ?? "").slice(0, 2000);
  const notifyClient = formData.get("notify") === "on";
  if (!isStatus(status)) throw new Error("Invalid status");

  const result = await setStatus(id, status, `staff:${staff.email}`, note);
  if (!result) throw new Error("Application not found");
  after(() => onStatusChanged(result.app, result.previous, { note, notifyClient }));
  revalidatePath(`/admin/applications/${id}`);
}

export async function addNoteAction(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const message = String(formData.get("message") ?? "").trim().slice(0, 4000);
  if (!message || !(await getApplication(id))) return;
  await addStaffNote(id, `staff:${staff.email}`, message, formData.get("clientVisible") === "on");
  revalidatePath(`/admin/applications/${id}`);
}

export async function resyncGhlAction(formData: FormData) {
  await requireStaff();
  const app = await getApplication(String(formData.get("id") ?? ""));
  const form = app && getForm(app.formSlug);
  if (!app || !form) throw new Error("Application not found");
  await pushToGhl(form, app);
  revalidatePath(`/admin/applications/${app.id}`);
}

export async function runAiReviewAction(formData: FormData) {
  await requireStaff();
  const app = await getApplication(String(formData.get("id") ?? ""));
  const form = app && getForm(app.formSlug);
  if (!app || !form) throw new Error("Application not found");
  await runAiReview(form, app);
  revalidatePath(`/admin/applications/${app.id}`);
}

export async function askAssistantAction(history: ChatTurn[]): Promise<AssistantReply | { error: string }> {
  await requireStaff();
  const client = aiClient();
  if (!client) return { error: "AI isn't set up yet — add ANTHROPIC_API_KEY in Vercel." };
  const turns = (Array.isArray(history) ? history : [])
    .filter((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .slice(-20)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }));
  if (turns.at(-1)?.role !== "user") return { error: "Ask a question first." };
  try {
    return await askAssistant(client, turns);
  } catch (err) {
    console.error("[assistant]", err);
    return { error: "The AI assistant couldn't answer right now. Please try again." };
  }
}

export async function regeneratePdfAction(formData: FormData) {
  await requireStaff();
  const app = await getApplication(String(formData.get("id") ?? ""));
  const form = app && getForm(app.formSlug);
  if (!app || !form) throw new Error("Application not found");
  await makePdf(form, app);
  revalidatePath(`/admin/applications/${app.id}`);
}

/** "User mode": open the client portal. With an email, see it exactly as that applicant does. */
export async function userModeAction(formData: FormData) {
  const staff = await requireStaff();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  await setPortalViewAs(staff.email, email || null);
  redirect("/portal");
}

/** Back from the client portal to the admin. */
export async function exitUserModeAction() {
  const session = await getSession();
  if (session?.role === "staff") await setPortalViewAs(session.email, null);
  redirect(session?.role === "staff" ? "/admin" : "/portal");
}

/** Permanently delete an application. Staff must type its reference to confirm. */
export async function deleteApplicationAction(formData: FormData) {
  const staff = await requireStaff();
  const app = await getApplication(String(formData.get("id") ?? ""));
  if (!app) throw new Error("Application not found");
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== app.reference) {
    redirect(`/admin/applications/${app.id}?deleteError=1#delete`);
  }
  await deleteApplication(app.id);
  console.info(`[admin] ${staff.email} deleted application ${app.reference} (${app.applicantEmail})`);
  revalidatePath("/admin");
  redirect(`/admin?deleted=${encodeURIComponent(app.reference)}`);
}

const applicantHref = (email: string, msg: string) =>
  `/admin/applicants/${encodeURIComponent(email)}?ghl=${encodeURIComponent(msg)}`;

/**
 * Link an applicant to their Lead Alchemist contact: the contact ID staff pasted, or else
 * Lead Alchemist's contact with the same email. Later syncs use the saved ID.
 */
export async function linkGhlContactAction(formData: FormData) {
  await requireStaff();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const pasted = String(formData.get("contactId") ?? "").trim();
  if (!email) throw new Error("Missing email");
  if (!ghlConfig()) redirect(applicantHref(email, "Lead Alchemist isn't connected yet (GHL_API_TOKEN / GHL_LOCATION_ID)."));

  // Accept a full Lead Alchemist contact URL as well as a bare ID.
  const id = pasted.match(/contacts\/detail\/([A-Za-z0-9]+)/)?.[1] ?? pasted;
  if (id && !/^[A-Za-z0-9]{6,64}$/.test(id)) redirect(applicantHref(email, `"${id.slice(0, 80)}" isn't a Lead Alchemist contact ID.`));

  let msg: string;
  try {
    const contact = id ? await getContact(id) : await findContactByEmail(email);
    if (contact) {
      await linkApplicantGhl(email, contact.id);
      msg = `Linked to Lead Alchemist contact ${[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email || contact.id}.`;
    } else {
      msg = id ? `No Lead Alchemist contact with ID ${id}.` : `No Lead Alchemist contact has the email ${email}. It will be created on the next sync.`;
    }
  } catch (err) {
    msg = `Lead Alchemist lookup failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  revalidatePath("/admin/applicants");
  redirect(applicantHref(email, msg));
}

export async function unlinkGhlContactAction(formData: FormData) {
  await requireStaff();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  await linkApplicantGhl(email, null);
  revalidatePath("/admin/applicants");
  redirect(applicantHref(email, "Unlinked. The next sync will match the Lead Alchemist contact by email."));
}

/** Look up every not-yet-linked applicant in Lead Alchemist by email (50 per click). */
export async function linkAllGhlAction() {
  await requireStaff();
  if (!ghlConfig()) redirect(`/admin/applicants?ghl=${encodeURIComponent("Lead Alchemist isn't connected yet.")}`);
  const emails = await unlinkedApplicantEmails(50);
  let linked = 0;
  let missing = 0;
  let failed = "";
  for (const email of emails) {
    try {
      const contact = await findContactByEmail(email);
      if (contact) {
        await linkApplicantGhl(email, contact.id);
        linked++;
      } else missing++;
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err);
      break;
    }
  }
  const msg = failed
    ? `Stopped after ${linked} linked: ${failed}`
    : `Linked ${linked} applicant${linked === 1 ? "" : "s"} to Lead Alchemist.${missing ? ` ${missing} have no Lead Alchemist contact yet.` : ""}`;
  revalidatePath("/admin/applicants");
  redirect(`/admin/applicants?ghl=${encodeURIComponent(msg)}`);
}
