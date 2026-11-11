import "server-only";
import { desc, eq, or } from "drizzle-orm";
import { after } from "next/server";
import { forms, getForm } from "@/forms";
import { getDb, schema } from "@/lib/db";
import type { Application } from "@/lib/db/schema";
import { defaultBrand } from "@/lib/brands";
import { answerSections } from "@/lib/forms/flatten";
import { isInputField, type Field, type FormDefinition, type FormValues } from "@/lib/forms/types";
import { pruneValues, validateForm } from "@/lib/forms/validate";
import { applicationPdfUrl } from "@/lib/applications/documents";
import { markResumeEmailed, resumeUrl, saveDraft } from "@/lib/applications/drafts";
import { addStaffNote, getApplication, getEvents, normalizeEmail, setStatus } from "@/lib/applications/repo";
import { isStatus, STATUS_KEYS, STATUSES } from "@/lib/applications/status";
import { sendMail } from "@/lib/mail";
import { resumeEmail } from "@/lib/mail/templates";

/**
 * What the AIS Connect API and MCP connector can do (one implementation for both), e.g. for Lead
 * Alchemist's Ask AI: read the forms, start an application for someone (they get a link to check it,
 * fill any gaps and sign it themselves), look applications up, change their status and add notes.
 * It never submits an application: only the applicant can, by signing. Nothing here deletes anything.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const appUrl = () => (process.env.APP_URL ?? "").replace(/\/$/, "");
const SKIP = new Set(["content", "signature", "file", "repeat"]);

export function listForms() {
  return Object.values(forms)
    .map((f) => ({ form: f.slug, title: f.title, website: defaultBrand(f), sections: f.sections.length }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function describeField(f: Field) {
  if (f.type === "table") {
    return {
      id: f.id,
      label: f.label,
      type: "table",
      columns: f.columns.map((c) => ({ id: c.id, label: c.label, type: c.type })),
      note: `Rows are answered as "${f.id}__<row>__<column id>" (row 1 to ${f.maxRows}), with "${f.id}__rows" set to the number of rows.`,
    };
  }
  if (!isInputField(f) || SKIP.has(f.type)) return null;
  return {
    id: f.id,
    label: f.label,
    type: f.type,
    required: !!f.required,
    ...("options" in f ? { options: f.options.map((o) => (o.label === o.value ? o.value : { value: o.value, label: o.label })) } : {}),
    ...(f.showIf ? { conditional: true } : {}),
    ...(f.compute ? { calculated: true } : {}),
    ...(f.hint ? { hint: f.hint } : {}),
  };
}

/** Numbered entries (e.g. Additional Insured #1, #2): how to answer more than the first. */
function repeatNotes(fields: Field[]) {
  const notes = fields.flatMap((f) => (f.type === "repeat" ? [`Entries are numbered: to fill entry n, set "${f.id}" to n (up to ${f.max}).`] : []));
  return notes.length ? { repeat: notes } : {};
}

/** A form's questions, section by section: what an assistant needs to ask and how to answer. */
export function describeForm(slug: string) {
  const form = getForm(slug);
  if (!form) throw new ApiError(`There's no form "${slug}". Use list_forms to see them.`, 404);
  return {
    form: form.slug,
    title: form.title,
    notes: [
      "Answer with the question ids. For choices, use one of the options (its value or label); several for checkboxes, as a list.",
      "Questions marked conditional only apply after certain answers (e.g. a follow-up to a Yes).",
      "Calculated answers are worked out by AIS Connect; don't send them.",
      "The signature is always the applicant's own: they sign on the link they're sent.",
    ],
    sections: form.sections.map((s) => ({
      title: s.title,
      questions: s.fields.map(describeField).filter(Boolean),
      ...repeatNotes(s.fields),
    })),
  };
}

/** Answers as AIS Connect stores them: option labels become their values; anything not a string or list is dropped. */
function normalizeValues(form: FormDefinition, input: unknown): FormValues {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError("answers must be an object of question id → answer.");
  const fields = new Map(form.sections.flatMap((s) => s.fields).filter(isInputField).map((f) => [f.id, f]));
  const out: FormValues = {};
  for (const [k, raw] of Object.entries(input as Record<string, unknown>)) {
    if (k === "signature") continue; // only ever the applicant's own
    const list = Array.isArray(raw) ? raw.map((x) => String(x)) : null;
    const v = list ?? (raw === null || raw === undefined ? undefined : String(raw).slice(0, 5_000));
    if (v === undefined) continue;
    const f = fields.get(k);
    if (f && "options" in f) {
      const pick = (x: string) => f.options.find((o) => o.value === x)?.value ?? f.options.find((o) => o.label.toLowerCase() === x.trim().toLowerCase())?.value ?? x;
      out[k] = Array.isArray(v) ? v.slice(0, 50).map(pick) : pick(v);
    } else out[k] = Array.isArray(v) ? v.slice(0, 50) : v;
  }
  return out;
}

/**
 * Start an application for someone: saves the answers given (as an unfinished application) and, unless
 * told not to, emails the applicant a private link to check them, answer what's missing and sign.
 */
export async function startApplication(input: { form?: unknown; answers?: unknown; sendEmail?: unknown }, actor: string) {
  const form = typeof input.form === "string" ? getForm(input.form) : undefined;
  if (!form) throw new ApiError(`Unknown form. Use list_forms to see them.`, 404);
  const values = pruneValues(form, normalizeValues(form, input.answers ?? {}));
  const email = typeof values.email === "string" ? normalizeEmail(values.email) : "";
  if (!email) throw new ApiError('The applicant\'s email is needed (answer "email"): the link to finish and sign goes there.');

  const errors = validateForm(form, values);
  delete errors.signature;
  const labels = new Map(form.sections.flatMap((s) => s.fields).filter(isInputField).map((f) => [f.id, f.label]));
  const stillNeeded = Object.entries(errors).map(([id, problem]) => ({ question: id, label: labels.get(id) ?? id, problem }));
  // The link opens on the first step with something left to do (else the signature step).
  const firstGap = form.sections.findIndex((s) => s.fields.some((f) => f.id in errors));
  const step = firstGap >= 0 ? firstGap : form.sections.length - 1;

  const saved = await saveDraft(form, { values, step });
  if (!saved) throw new ApiError("Couldn't save the application.", 500);
  const link = resumeUrl(form.slug, saved.ref);
  const { linkDraftClient, syncDraftStarted } = await import("@/lib/applications/pipeline");
  after(() => Promise.allSettled([linkDraftClient(form, saved.draft), syncDraftStarted(form, saved.draft)]));

  let emailed = false;
  if (input.sendEmail !== false) {
    await sendMail({ to: email, ...resumeEmail({ form, businessName: saved.draft.businessName, url: link }) });
    await markResumeEmailed(saved.draft.id);
    emailed = true;
  }
  console.info(`[api] ${actor} started a ${form.slug} application (draft ${saved.draft.id})`);
  return {
    started: true,
    form: form.slug,
    draftId: saved.draft.id,
    applicantLink: link,
    emailedTo: emailed ? email : null,
    stillNeeded,
    note: "Not submitted yet: the applicant checks it, answers anything still needed and signs on the link.",
  };
}

function summarize(app: Application) {
  return {
    id: app.id,
    reference: app.reference,
    form: app.formSlug,
    formTitle: getForm(app.formSlug)?.title ?? app.formSlug,
    status: app.status,
    statusLabel: STATUSES[app.status].label,
    applicant: app.applicantName,
    email: app.applicantEmail,
    business: app.businessName,
    submittedAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    importedFromLeadAlchemist: app.importedFrom === "lead_alchemist",
    test: app.isTest,
    adminUrl: `${appUrl()}/admin/applications/${app.id}`,
    pdfUrl: applicationPdfUrl(app),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Applications for an email, a Lead Alchemist contact, a reference, or a name/business search; newest first. */
export async function findApplications(input: { email?: unknown; leadAlchemistContactId?: unknown; reference?: unknown; search?: unknown; limit?: unknown }) {
  const db = await getDb();
  const a = schema.applications;
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  let rows: Application[];
  if (str(input.email)) rows = await db.select().from(a).where(eq(a.applicantEmail, normalizeEmail(str(input.email)))).orderBy(desc(a.createdAt)).limit(limit);
  else if (str(input.leadAlchemistContactId)) rows = await db.select().from(a).where(eq(a.ghlContactId, str(input.leadAlchemistContactId))).orderBy(desc(a.createdAt)).limit(limit);
  else if (str(input.reference)) rows = await db.select().from(a).where(eq(a.reference, str(input.reference).toUpperCase())).limit(1);
  else if (str(input.search)) {
    const { searchApplications } = await import("@/lib/applications/repo");
    const hits = await searchApplications({ q: str(input.search).slice(0, 200), limit });
    rows = hits.length ? await db.select().from(a).where(or(...hits.map((h) => eq(a.id, h.id)))!).orderBy(desc(a.createdAt)) : [];
  } else throw new ApiError("Give an email, leadAlchemistContactId, reference or search.");
  return { count: rows.length, applications: rows.map(summarize) };
}

async function resolve(idOrReference: unknown) {
  const key = typeof idOrReference === "string" ? idOrReference.trim() : "";
  let app: Application | undefined;
  if (UUID.test(key)) app = await getApplication(key);
  else if (/^AIS-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(key)) {
    const db = await getDb();
    [app] = await db.select().from(schema.applications).where(eq(schema.applications.reference, key.toUpperCase())).limit(1);
  }
  if (!app) throw new ApiError("No application with that id or reference.", 404);
  return app;
}

/** One application: status, answers and recent activity. */
export async function applicationDetails(idOrReference: unknown) {
  const app = await resolve(idOrReference);
  const form = getForm(app.formSlug);
  const events = (await getEvents(app.id)).slice(0, 15);
  return {
    ...summarize(app),
    answers: form ? answerSections(form, app.values).map((s) => ({ section: s.title, answers: s.rows.map((r) => ({ question: r.group ? `${r.group}: ${r.label}` : r.label, answer: r.value })) })) : [],
    activity: events.map((e) => ({ at: e.createdAt.toISOString(), type: e.type, by: e.actor, message: e.message ?? null })),
  };
}

/** Change an application's status (logged; the applicant is emailed only when notifyApplicant is true). */
export async function changeStatus(input: { application?: unknown; status?: unknown; note?: unknown; notifyApplicant?: unknown }, actor: string) {
  const app = await resolve(input.application);
  if (!isStatus(input.status)) throw new ApiError(`status must be one of: ${STATUS_KEYS.join(", ")}.`);
  const note = typeof input.note === "string" ? input.note.slice(0, 2000) : "";
  const result = await setStatus(app.id, input.status, actor, note);
  if (!result) throw new ApiError("No application with that id or reference.", 404);
  const { onStatusChanged } = await import("@/lib/applications/pipeline");
  after(() => onStatusChanged(result.app, result.previous, { note, notifyClient: input.notifyApplicant === true }));
  return { ...summarize(result.app), previousStatus: result.previous, applicantNotified: input.notifyApplicant === true };
}

/** Add a staff note to an application (visible to the applicant only when clientVisible is true). */
export async function addNote(input: { application?: unknown; note?: unknown; clientVisible?: unknown }, actor: string) {
  const app = await resolve(input.application);
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 4000) : "";
  if (!note) throw new ApiError("note is empty.");
  await addStaffNote(app.id, actor, note, input.clientVisible === true);
  return { added: true, application: app.reference, clientVisible: input.clientVisible === true };
}

export const STATUS_OPTIONS = STATUS_KEYS.map((k) => ({ status: k, label: STATUSES[k].label, meaning: STATUSES[k].description }));
