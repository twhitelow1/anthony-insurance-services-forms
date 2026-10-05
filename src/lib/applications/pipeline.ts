import "server-only";
import type { Application } from "@/lib/db/schema";
import type { FormDefinition } from "@/lib/forms/types";
import { ghlConfig } from "@/lib/ghl/client";
import { syncNewApplication, syncStatus } from "@/lib/ghl/sync";
import { emailLayout, sendMail } from "@/lib/mail";
import { aiClient } from "@/lib/ai/client";
import { reviewApplication } from "@/lib/ai/review";
import { createApplicationPdf, documentUrl, latestDocument } from "./documents";
import { addEvent, saveAiReview, setGhlIds } from "./repo";
import { STATUSES, type ApplicationStatus } from "./status";

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Everything that happens after a submission is safely stored. Never throws. */
export async function onApplicationSubmitted(form: FormDefinition, app: Application) {
  // The PDF comes first so its link can go onto the GHL contact.
  await Promise.allSettled([
    makePdf(form, app).then(() => pushToGhl(form, app)),
    sendConfirmation(form, app),
    runAiReview(form, app),
  ]);
}

/** Generate and store the application PDF. Never throws. */
export async function makePdf(form: FormDefinition, app: Application) {
  try {
    const doc = await createApplicationPdf(form, app);
    await addEvent(app.id, "pdf_created", "system", {
      message: `Application PDF created (${Math.round(doc.size / 1024)} KB)`,
      data: { documentId: doc.id },
    });
    return doc;
  } catch (err) {
    console.error("[pipeline] PDF generation failed", app.reference, err);
    await addEvent(app.id, "pdf_failed", "system", { message: describe(err) }).catch(() => {});
  }
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
    const pdf = await latestDocument(app.id);
    const { contactId, opportunityId, missingFields } = await syncNewApplication(form, app, pdf ? documentUrl(pdf) : undefined);
    await setGhlIds(app.id, { contactId, opportunityId });
    await addEvent(app.id, "ghl_synced", "system", {
      message: [
        opportunityId ? "Contact and opportunity synced to GoHighLevel" : "Contact synced to GoHighLevel",
        missingFields.length ? `Create these GHL custom fields to show them on the contact: ${missingFields.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(". "),
      data: { contactId, opportunityId, missingFields },
    });
  } catch (err) {
    console.error("[pipeline] GHL sync failed", app.reference, err);
    await addEvent(app.id, "ghl_sync_failed", "system", { message: describe(err) }).catch(() => {});
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
