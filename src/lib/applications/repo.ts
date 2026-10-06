import "server-only";
import { randomInt } from "node:crypto";
import { and, count, desc, eq, ilike, max, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Application, EventType } from "@/lib/db/schema";
import type { AiReview } from "@/lib/ai/review";
import { searchText } from "@/lib/forms/flatten";
import type { FormDefinition, FormValues } from "@/lib/forms/types";
import type { ApplicationStatus } from "./status";

const { applications, applicationEvents } = schema;

// Crockford-style alphabet: no 0/O, 1/I/L confusion when read over the phone.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const newReference = () => {
  const pick = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `AIS-${pick()}-${pick()}`;
};

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

const str = (v: FormValues[string]) => (typeof v === "string" ? v.trim() : "");

/** Columns derived from the answers, kept in sync on create and edit. */
function derived(form: FormDefinition, values: FormValues, reference: string) {
  const { signature, ...answers } = values;
  const email = normalizeEmail(str(values.email));
  const name = [str(values.first_name), str(values.last_name)].filter(Boolean).join(" ");
  const businessName = str(values.legal_business_name) || null;
  return {
    applicantEmail: email,
    applicantName: name || email,
    businessName,
    state: str(values.mailing_state) || null,
    values: answers,
    signature: typeof signature === "string" ? signature : null,
    searchText: searchText(form, answers, [reference, email, name, businessName ?? "", str(values.dba)]),
  };
}

export async function createApplication(
  form: FormDefinition,
  values: FormValues,
  meta: { ip?: string; userAgent?: string },
): Promise<Application> {
  const db = await getDb();

  for (let attempt = 0; ; attempt++) {
    const reference = newReference();
    try {
      const [app] = await db
        .insert(applications)
        .values({
          reference,
          formSlug: form.slug,
          ...derived(form, values, reference),
          submittedIp: meta.ip,
          submittedUserAgent: meta.userAgent,
        })
        .returning();
      await addEvent(app.id, "submitted", "client:" + app.applicantEmail, { clientVisible: true, message: "Application submitted" });
      return app;
    } catch (err) {
      // Reference collision is astronomically unlikely; retry a couple of times then give up.
      if (attempt < 2 && String(err).includes("applications_reference_unique")) continue;
      throw err;
    }
  }
}

export async function addEvent(
  applicationId: string,
  type: EventType,
  actor: string,
  opts: { clientVisible?: boolean; message?: string; data?: Record<string, unknown> } = {},
) {
  const db = await getDb();
  await db.insert(applicationEvents).values({
    applicationId,
    type,
    actor,
    clientVisible: opts.clientVisible ?? false,
    message: opts.message,
    data: opts.data,
  });
}

export async function getApplication(id: string): Promise<Application | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const db = await getDb();
  const [app] = await db.select().from(applications).where(eq(applications.id, id)).limit(1);
  return app;
}

export async function getEvents(applicationId: string, { clientOnly = false } = {}) {
  const db = await getDb();
  return db
    .select()
    .from(applicationEvents)
    .where(
      clientOnly
        ? and(eq(applicationEvents.applicationId, applicationId), eq(applicationEvents.clientVisible, true))
        : eq(applicationEvents.applicationId, applicationId),
    )
    .orderBy(desc(applicationEvents.createdAt), desc(applicationEvents.id));
}

/** Columns for list views — never loads the answers or the signature. */
const listColumns = {
  id: applications.id,
  reference: applications.reference,
  formSlug: applications.formSlug,
  status: applications.status,
  applicantName: applications.applicantName,
  applicantEmail: applications.applicantEmail,
  businessName: applications.businessName,
  state: applications.state,
  createdAt: applications.createdAt,
  updatedAt: applications.updatedAt,
  aiHighFlags: applications.aiHighFlags,
};
export type ApplicationListItem = {
  [K in keyof typeof listColumns]: Application[K];
};

export async function listForEmail(email: string): Promise<ApplicationListItem[]> {
  const db = await getDb();
  return db
    .select(listColumns)
    .from(applications)
    .where(eq(applications.applicantEmail, normalizeEmail(email)))
    .orderBy(desc(applications.createdAt));
}

export async function hasApplications(email: string) {
  const db = await getDb();
  const rows = await db
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.applicantEmail, normalizeEmail(email)))
    .limit(1);
  return rows.length > 0;
}

export interface SearchParams {
  q?: string;
  status?: ApplicationStatus;
  state?: string;
  limit?: number;
  offset?: number;
}

/**
 * Staff search: full-text over every answer (stemmed, so "trampoline" matches
 * "trampolines"), plus partial matches on reference, name, email, and business.
 */
export async function searchApplications({ q, status, state, limit = 50, offset = 0 }: SearchParams) {
  const db = await getDb();
  const where: SQL[] = [];
  const query = q?.trim();
  if (query) {
    const like = `%${query.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    where.push(
      or(
        sql`to_tsvector('english', ${applications.searchText}) @@ websearch_to_tsquery('english', ${query})`,
        ilike(applications.reference, like),
        ilike(applications.applicantName, like),
        ilike(applications.applicantEmail, like),
        ilike(applications.businessName, like),
      )!,
    );
  }
  if (status) where.push(eq(applications.status, status));
  if (state) where.push(eq(applications.state, state.toUpperCase()));

  const rank = sql<number>`ts_rank(to_tsvector('english', ${applications.searchText}), websearch_to_tsquery('english', ${query ?? ""}))`;

  return db
    .select(listColumns)
    .from(applications)
    .where(where.length ? and(...where) : undefined)
    .orderBy(...(query ? [desc(rank), desc(applications.createdAt)] : [desc(applications.createdAt)]))
    .limit(Math.min(limit, 200))
    .offset(offset);
}

export async function setStatus(
  id: string,
  status: ApplicationStatus,
  actor: string,
  note?: string,
): Promise<{ app: Application; previous: ApplicationStatus } | undefined> {
  const db = await getDb();
  const current = await getApplication(id);
  if (!current) return undefined;
  const [app] = await db
    .update(applications)
    .set({ status, updatedAt: new Date() })
    .where(eq(applications.id, id))
    .returning();
  await addEvent(id, "status_changed", actor, {
    clientVisible: true,
    message: note?.trim() || undefined,
    data: { from: current.status, to: status },
  });
  return { app, previous: current.status };
}

export async function addStaffNote(id: string, actor: string, message: string, clientVisible: boolean) {
  await addEvent(id, "staff_note", actor, { clientVisible, message: message.trim() });
}

export async function setGhlIds(id: string, ids: { contactId: string; opportunityId?: string }) {
  const db = await getDb();
  await db
    .update(applications)
    .set({ ghlContactId: ids.contactId, ...(ids.opportunityId ? { ghlOpportunityId: ids.opportunityId } : {}) })
    .where(eq(applications.id, id));
}

export async function saveAiReview(id: string, review: AiReview) {
  const db = await getDb();
  await db
    .update(applications)
    .set({ aiReview: review, aiHighFlags: review.flags.filter((f) => f.severity === "high").length })
    .where(eq(applications.id, id));
}

export async function getByReference(reference: string): Promise<Application | undefined> {
  const db = await getDb();
  const [app] = await db
    .select()
    .from(applications)
    .where(eq(applications.reference, reference.trim().toUpperCase()))
    .limit(1);
  return app;
}

/**
 * Staff edit of the answers. Returns the updated application and the labels of
 * the questions that changed (recorded on the activity log).
 */
export async function updateAnswers(
  form: FormDefinition,
  id: string,
  values: FormValues,
  actor: string,
): Promise<{ app: Application; changed: string[] } | undefined> {
  const current = await getApplication(id);
  if (!current) return undefined;
  const next = derived(form, values, current.reference);
  // Keep the applicant's signature unless staff replaced it.
  if (!next.signature) next.signature = current.signature;

  const before: FormValues = { ...current.values, signature: current.signature ?? undefined };
  const after: FormValues = { ...next.values, signature: next.signature ?? undefined };
  const labels = new Map(form.sections.flatMap((s) => s.fields).map((f) => [f.id, "label" in f && f.label ? f.label : f.id]));
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...keys]
    .filter((k) => JSON.stringify(before[k] ?? "") !== JSON.stringify(after[k] ?? ""))
    .map((k) => labels.get(k) ?? labels.get(k.split("__")[0]) ?? k);
  const uniqueChanged = [...new Set(changed)];

  const db = await getDb();
  const [app] = await db
    .update(applications)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(applications.id, id))
    .returning();
  await addEvent(id, "answers_edited", actor, {
    message: uniqueChanged.length ? `Edited: ${uniqueChanged.join(", ")}` : "Saved with no changes",
    data: { changed: uniqueChanged },
  });
  return { app, changed: uniqueChanged };
}

/** Permanently delete an application with its PDFs and activity log. */
export async function deleteApplication(id: string) {
  const db = await getDb();
  const [row] = await db
    .delete(applications)
    .where(eq(applications.id, id))
    .returning({ reference: applications.reference });
  return row;
}

export interface ApplicantSummary {
  email: string;
  name: string;
  businessName: string | null;
  applications: number;
  lastApplied: Date;
}

/** Everyone who has applied, one row per email address, most recent first. */
export async function listApplicants({ q, limit = 100 }: { q?: string; limit?: number } = {}): Promise<ApplicantSummary[]> {
  const db = await getDb();
  const query = q?.trim();
  const like = query ? `%${query.replace(/[%_\\]/g, (c) => "\\" + c)}%` : undefined;
  const rows = await db
    .select({
      email: applications.applicantEmail,
      name: max(applications.applicantName),
      businessName: max(applications.businessName),
      applications: count(),
      lastApplied: max(applications.createdAt),
    })
    .from(applications)
    .where(
      like
        ? or(ilike(applications.applicantEmail, like), ilike(applications.applicantName, like), ilike(applications.businessName, like))
        : undefined,
    )
    .groupBy(applications.applicantEmail)
    .orderBy(desc(max(applications.createdAt)))
    .limit(Math.min(limit, 500));
  return rows.map((r) => ({
    email: r.email,
    name: r.name ?? r.email,
    businessName: r.businessName,
    applications: Number(r.applications),
    lastApplied: r.lastApplied ?? new Date(0),
  }));
}
