import "server-only";
import type { Application } from "@/lib/db/schema";
import type { FormDefinition } from "@/lib/forms/types";
import { ghlConfig } from "@/lib/ghl/client";
import { getSettings } from "@/lib/settings";
import { syncNewApplication, syncStatus } from "@/lib/ghl/sync";
import { emailLayout, sendMail } from "@/lib/mail";
import { aiClient } from "@/lib/ai/client";
import { reviewApplication } from "@/lib/ai/review";
import { applicationPdfUrl, createApplicationPdf, createCarrierPdf, mainDocument } from "./documents";
import { addEvent, getApplicant, linkApplicantGhl, saveAiReview, setGhlIds } from "./repo";
import { STATUSES, type ApplicationStatus } from "./status";

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Everything that happens after a submission is safely stored. Never throws. */
export async function onApplicationSubmitted(form: FormDefinition, app: Application) {
  // The PDF comes first so its link can go onto the GHL contact.
  await Promise.allSettled([
    makePdf(form, app).then(() => Promise.allSettled([pushToGhl(form, app), notifyStaff(form, app)])),
    sendConfirmation(form, app),
    runAiReview(form, app),
  ]);
}

/** Fill the carrier's application and create the answer summary, then store both. Never throws. */
export async function makePdf(form: FormDefinition, app: Application) {
  // One after the other: the carrier form first, so it's what the GHL link and portal show from the start.
  for (const task of [
    async () => {
      try {
        const result = await createCarrierPdf(app);
        if (!result) return;
        const { doc, unknownFields, addendumCount } = result;
        await addEvent(app.id, "pdf_created", "system", {
          message: [
            `Carrier application filled (${Math.round(doc.size / 1024)} KB)`,
            addendumCount ? `${addendumCount} item(s) on the addendum page` : null,
            unknownFields.length ? `Not on the carrier PDF: ${unknownFields.join(", ")}` : null,
          ]
            .filter(Boolean)
            .join(". "),
          data: { documentId: doc.id, kind: doc.kind, unknownFields },
        });
      } catch (err) {
        console.error("[pipeline] carrier PDF failed", app.reference, err);
        await addEvent(app.id, "pdf_failed", "system", { message: `Carrier application: ${describe(err)}` }).catch(() => {});
      }
    },
    async () => {
      try {
        const doc = await createApplicationPdf(form, app);
        await addEvent(app.id, "pdf_created", "system", {
          message: `Application PDF created (${Math.round(doc.size / 1024)} KB)`,
          data: { documentId: doc.id, kind: doc.kind },
        });
      } catch (err) {
        console.error("[pipeline] summary PDF failed", app.reference, err);
        await addEvent(app.id, "pdf_failed", "system", { message: `Application PDF: ${describe(err)}` }).catch(() => {});
      }
    },
  ])
    await task();
}

/** Claude pre-review for the agent. Skipped when no ANTHROPIC_API_KEY is set. */
export async function runAiReview(form: FormDefinition, app: Application) {
  const client = aiClient();
  if (!client) return;
  try {
    const review = await reviewApplication(client, form, app.values, { reference: app.reference });
    await saveAiReview(app.id, review);
    const high = review.flags.filter((f) => f.severity === "high").length;
    await addEvent(app.id, "ai_reviewed", "system", {
      message: `AI review: ${review.flags.length} flag(s)${high ? `, ${high} high` : ""}`,
    });
  } catch (err) {
    console.error("[pipeline] AI review failed", app.reference, err);
    await addEvent(app.id, "ai_review_failed", "system", { message: describe(err) }).catch(() => {});
  }
}

export async function pushToGhl(form: FormDefinition, app: Application) {
  if (!ghlConfig()) return;
  try {
    const pdf = await mainDocument(app.id);
    // Same email → same GHL contact: use the contact ID saved from earlier syncs.
    const saved = await getApplicant(app.applicantEmail);
    const r = await syncNewApplication(form, app, pdf ? applicationPdfUrl(app) : undefined, saved?.ghlContactId);
    await setGhlIds(app.id, { contactId: r.contactId, opportunityId: r.opportunityId });
    await linkApplicantGhl(app.applicantEmail, r.contactId);
    const missing = [
      r.missingFields.length ? `contact fields: ${r.missingFields.join(", ")}` : null,
      r.missingOpportunityFields?.length ? `opportunity fields: ${r.missingOpportunityFields.join(", ")}` : null,
    ].filter(Boolean);
    await addEvent(app.id, "ghl_synced", "system", {
      message: `Synced to GoHighLevel: ${[
        r.matchedBy === "saved_id" ? "matched the applicant's saved GHL contact" : "matched the GHL contact by email",
        r.opportunityId
          ? r.movedFromLead
            ? "moved the lead's opportunity from the lead pipeline into the applications pipeline"
            : "created this application's opportunity"
          : null,
        missing.length ? `create these GHL custom fields to fill them in: ${missing.join("; ")}` : null,
      ]
        .filter(Boolean)
        .join("; ")}`,
      data: { ...r },
    });
  } catch (err) {
    console.error("[pipeline] GHL sync failed", app.reference, err);
    await addEvent(app.id, "ghl_sync_failed", "system", { message: describe(err) }).catch(() => {});
  }
}

/** Staff told about every new application (Admin → Settings, else NOTIFY_EMAILS). */
export const staffNotifyList = async () => (await getSettings()).notifyEmails;

async function notifyStaff(form: FormDefinition, app: Application) {
  const to = await staffNotifyList();
  if (!to.length) return;
  try {
    const pdf = await mainDocument(app.id);
    const effective = typeof app.values.requested_effective_date === "string" ? app.values.requested_effective_date : null;
    await sendMail({
      to,
      subject: `New ${form.title}: ${app.businessName ?? app.applicantName} (${app.reference})`,
      html: emailLayout({
        heading: `New application: ${app.businessName ?? app.applicantName}`,
        paragraphs: [
          `${form.title} from ${app.applicantName} (${app.applicantEmail})${app.state ? `, ${app.state}` : ""}.`,
          ...(effective ? [`Requested effective date: ${effective}.`] : []),
          pdf ? `The application PDF is ready: ${appUrl()}/applications/${app.id}/pdf` : "The PDF is still being created.",
        ],
        button: { label: "Open the application", url: `${appUrl()}/admin/applications/${app.id}` },
      }),
    });
    await addEvent(app.id, "email_sent", "system", { message: `New-application alert sent to ${to.length} staff address(es)` });
  } catch (err) {
    console.error("[pipeline] staff alert failed", app.reference, err);
    await addEvent(app.id, "email_failed", "system", { message: `Staff alert: ${describe(err)}` }).catch(() => {});
  }
}

async function sendConfirmation(form: FormDefinition, app: Application) {
  try {
    await sendMail({
      to: app.applicantEmail,
      subject: `We received your application (${app.reference})`,
      html: emailLayout({
        heading: "Thanks — your application is in",
        paragraphs: [
          `We've received your ${form.title} for ${app.businessName ?? app.applicantName}. Your reference number is ${app.reference}.`,
          "You can check its status any time — sign in with this email address and we'll send you a one-time link. No password needed.",
        ],
        button: { label: "Check application status", url: `${appUrl()}/portal/login` },
      }),
    });
    await addEvent(app.id, "email_sent", "system", { message: "Confirmation email sent to applicant" });
  } catch (err) {
    console.error("[pipeline] confirmation email failed", app.reference, err);
    await addEvent(app.id, "email_failed", "system", { message: describe(err) }).catch(() => {});
  }
}

/** After a staff status change: mirror to GHL and (optionally) email the client. */
export async function onStatusChanged(app: Application, previous: ApplicationStatus, opts: { note?: string; notifyClient: boolean }) {
  const { note, notifyClient } = opts;
  const tasks: Promise<unknown>[] = [];
  if (ghlConfig() && app.ghlContactId) {
    tasks.push(
      syncStatus(app, previous).catch(async (err) => {
        console.error("[pipeline] GHL status sync failed", app.reference, err);
        await addEvent(app.id, "ghl_sync_failed", "system", { message: `Status sync: ${describe(err)}` });
      }),
    );
  }
  if (notifyClient) tasks.push(
    sendMail({
      to: app.applicantEmail,
      subject: `Application ${app.reference}: ${STATUSES[app.status].label}`,
      html: emailLayout({
        heading: `Status update: ${STATUSES[app.status].label}`,
        paragraphs: [STATUSES[app.status].description, ...(note?.trim() ? [`Note from your agent: ${note.trim()}`] : [])],
        button: { label: "View your application", url: `${appUrl()}/portal/login` },
      }),
    }).catch(async (err) => {
      console.error("[pipeline] status email failed", app.reference, err);
      await addEvent(app.id, "email_failed", "system", { message: `Status email: ${describe(err)}` });
    }),
  );
  await Promise.allSettled(tasks);
}
