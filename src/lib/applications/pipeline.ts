import "server-only";
import type { Application, Draft } from "@/lib/db/schema";
import type { FormDefinition } from "@/lib/forms/types";
import { ghlConfig } from "@/lib/ghl/client";
import { getSettings } from "@/lib/settings";
import { syncNewApplication, syncStartedApplication, syncStatus } from "@/lib/ghl/sync";
import { setDraftGhlContact } from "./drafts";
import { emailLayout, sendMail } from "@/lib/mail";
import { aiClient } from "@/lib/ai/client";
import { reviewApplication } from "@/lib/ai/review";
import { applicationPdfUrl, createApplicationPdf, createCarrierPdf, mainDocument } from "./documents";
import { addEvent, getApplicant, linkApplicantGhl, saveAiReview, setGhlIds } from "./repo";
import { STATUSES, type ApplicationStatus } from "./status";
import { libraryForForm, libraryUrl } from "@/lib/library";
import { getForm } from "@/forms";
import { complianceAttachments } from "@/lib/compliance";
import { confirmationEmail, statusEmail } from "@/lib/mail/templates";
import { missingUploads } from "@/lib/forms/validate";
import { standardContactFields } from "@/lib/ghl/sync";
import { assignApplicationClient, assignDraftClient } from "@/lib/clients/repo";
import { links } from "@/lib/integrations/links";
import { salesforceConfig } from "@/lib/salesforce/config";
import { enqueueSalesforceSync, runJob } from "@/lib/salesforce/jobs";

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Everything that happens after a submission is safely stored. Never throws. */
export async function onApplicationSubmitted(form: FormDefinition, app: Application) {
  // The client record first: its page is linked from Lead Alchemist and Salesforce.
  const clientId = await linkClient(form, app);
  // The PDF comes next so its link can go onto the Lead Alchemist contact; Salesforce goes last so
  // it can carry the Lead Alchemist links (and Lead Alchemist gets the Salesforce ones back).
  await Promise.allSettled([
    makePdf(form, app).then(() =>
      Promise.allSettled([pushToGhl(form, app, clientId).then(() => pushToSalesforce(app)), notifyStaff(form, app)]),
    ),
    sendConfirmation(form, app),
    runAiReview(form, app),
  ]);
}

const clientDetails = (form: FormDefinition, values: Application["values"], email: string, name: string | null, business: string | null) => {
  const c = standardContactFields(form, values);
  return {
    email,
    contactName: name,
    businessName: business,
    phone: c.phone,
    address: { street: c.address1, city: c.city, state: c.state, postalCode: c.postalCode },
  };
};

/** Attach the application to its client (created on first application). Never throws. */
async function linkClient(form: FormDefinition, app: Application): Promise<string | null> {
  try {
    return await assignApplicationClient(app.id, clientDetails(form, app.values, app.applicantEmail, app.applicantName, app.businessName));
  } catch (err) {
    console.error("[pipeline] client record failed", app.reference, err);
    return null;
  }
}

/**
 * Queue the Salesforce sync and run it once now. Never throws, never blocks the applicant:
 * a failure stays queued and is retried with backoff (src/lib/salesforce/jobs.ts).
 * Test submissions never go to Salesforce.
 */
export async function pushToSalesforce(app: Pick<Application, "id" | "isTest" | "reference">) {
  if (app.isTest || !salesforceConfig()) return;
  try {
    if (!(await getSettings()).salesforceEnabled) return;
    const jobId = await enqueueSalesforceSync(app.id);
    await runJob(jobId);
  } catch (err) {
    console.error("[pipeline] Salesforce sync couldn't be queued", app.reference, err);
  }
}

/** Fill the carrier's application and create the answer summary, then store both. Never throws. */
export async function makePdf(form: FormDefinition, app: Application) {
  // One after the other: the carrier form first, so it's what the Lead Alchemist link and portal show from the start.
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

export async function pushToGhl(form: FormDefinition, app: Application, clientId?: string | null) {
  if (!ghlConfig()) return;
  try {
    const pdf = await mainDocument(app.id);
    // Same email → same Lead Alchemist contact: use the contact ID saved from earlier syncs.
    const saved = await getApplicant(app.applicantEmail);
    const clientPage = clientId ? (await links()).appClient(clientId) : null;
    const r = await syncNewApplication(form, app, pdf ? applicationPdfUrl(app) : undefined, saved?.ghlContactId, clientPage);
    await setGhlIds(app.id, { contactId: r.contactId, opportunityId: r.opportunityId });
    await linkApplicantGhl(app.applicantEmail, r.contactId);
    const missing = [
      r.missingFields.length ? `contact fields: ${r.missingFields.join(", ")}` : null,
      r.missingOpportunityFields?.length ? `opportunity fields: ${r.missingOpportunityFields.join(", ")}` : null,
    ].filter(Boolean);
    await addEvent(app.id, "ghl_synced", "system", {
      message: `Synced to Lead Alchemist: ${[
        r.matchedBy === "saved_id" ? "matched the applicant's saved Lead Alchemist contact" : "matched the Lead Alchemist contact by email",
        r.opportunityId
          ? r.movedFromLead
            ? "moved the lead's opportunity from the lead pipeline into the applications pipeline"
            : "created this application's opportunity"
          : null,
        missing.length ? `create these Lead Alchemist custom fields to fill them in: ${missing.join("; ")}` : null,
      ]
        .filter(Boolean)
        .join("; ")}`,
      data: { ...r },
    });
  } catch (err) {
    console.error("[pipeline] Lead Alchemist sync failed", app.reference, err);
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
      subject: `${app.isTest ? "[TEST] " : ""}New ${form.title}: ${app.businessName ?? app.applicantName} (${app.reference})`,
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
    // Documents assigned to this form in Admin → Documents (sample waiver etc.).
    const docs = await libraryForForm(form.slug).catch(() => []);
    // Compliance popups the applicant saw (e.g. no concussion policy): attach the sample documents.
    const compliance = await complianceAttachments(form, app.values);
    const { attachments } = compliance;
    // Plus uploads asked for but not given, e.g. "a signed waiver is required before coverage starts".
    const notices = [...compliance.notices, ...missingUploads(form, app.values)];
    const email = confirmationEmail({
      form,
      app,
      appUrl: appUrl(),
      documents: docs.map((d) => ({ title: d.title, description: d.description, url: libraryUrl(d) })),
      notices,
    });
    await sendMail({ to: app.applicantEmail, ...email, attachments });
    await addEvent(app.id, "email_sent", "system", {
      message: `Confirmation email sent to applicant${attachments.length ? ` with ${attachments.map((a) => a.name).join(", ")}` : ""}`,
    });
  } catch (err) {
    console.error("[pipeline] confirmation email failed", app.reference, err);
    await addEvent(app.id, "email_failed", "system", { message: describe(err) }).catch(() => {});
  }
}

/** After a staff status change: mirror to Lead Alchemist and (optionally) email the client. */
export async function onStatusChanged(app: Application, previous: ApplicationStatus, opts: { note?: string; notifyClient: boolean }) {
  const { note, notifyClient } = opts;
  const tasks: Promise<unknown>[] = [];
  if (ghlConfig() && app.ghlContactId) {
    tasks.push(
      syncStatus(app, previous).catch(async (err) => {
        console.error("[pipeline] Lead Alchemist status sync failed", app.reference, err);
        await addEvent(app.id, "ghl_sync_failed", "system", { message: `Status sync: ${describe(err)}` });
      }),
    );
  }
  // Keep the Salesforce Opportunity's stage in step (only once it's been synced).
  if (app.sfOpportunityId) tasks.push(pushToSalesforce(app));
  if (notifyClient) tasks.push(
    sendMail({
      to: app.applicantEmail,
      ...statusEmail({ form: getForm(app.formSlug), app, status: STATUSES[app.status], note, appUrl: appUrl() }),
    }).catch(async (err) => {
      console.error("[pipeline] status email failed", app.reference, err);
      await addEvent(app.id, "email_failed", "system", { message: `Status email: ${describe(err)}` });
    }),
  );
  await Promise.allSettled(tasks);
}

/** An applicant started a form and gave an email: they're a prospect (Admin → Clients). Never throws. */
export async function linkDraftClient(form: FormDefinition, draft: Draft) {
  if (!draft.email) return;
  try {
    await assignDraftClient(draft.id, clientDetails(form, draft.values, draft.email, draft.name, draft.businessName));
  } catch (err) {
    console.error("[pipeline] prospect client record failed", draft.id, err);
  }
}

/** An applicant started a form and gave an email: tell Lead Alchemist ("app-started"). Never throws. */
export async function syncDraftStarted(form: FormDefinition, draft: Draft) {
  if (!ghlConfig() || !draft.email) return;
  try {
    const saved = await getApplicant(draft.email);
    const { contactId } = await syncStartedApplication(form, draft.values, saved?.ghlContactId);
    await setDraftGhlContact(draft.id, contactId);
    await linkApplicantGhl(draft.email, contactId);
  } catch (err) {
    console.error("[pipeline] Lead Alchemist sync for a started application failed", draft.id, err);
  }
}
