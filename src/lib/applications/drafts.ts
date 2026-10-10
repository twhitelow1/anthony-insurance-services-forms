import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Draft } from "@/lib/db/schema";
import type { FormDefinition, FormValues } from "@/lib/forms/types";
import { pruneValues } from "@/lib/forms/validate";
import { normalizeEmail } from "./repo";

/**
 * Unfinished applications. The browser keeps `{ id, token }` (the token is the
 * resume secret; only its hash is stored) and saves after each section.
 */
const { drafts } = schema;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const str = (v: FormValues[string]) => (typeof v === "string" ? v.trim() : "");

export interface DraftRef {
  id: string;
  token: string;
}

/** "<id>.<token>" as carried in resume links. */
export const encodeRef = (ref: DraftRef) => `${ref.id}.${ref.token}`;
export function decodeRef(raw: unknown): DraftRef | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^([0-9a-f-]{36})\.([A-Za-z0-9_-]{30,100})$/);
  return m ? { id: m[1], token: m[2] } : null;
}

const appBase = () => (process.env.APP_URL ?? "").replace(/\/$/, "");
export const resumeUrl = (slug: string, ref: DraftRef) => `${appBase()}/forms/${slug}?resume=${encodeURIComponent(encodeRef(ref))}`;

function summary(values: FormValues) {
  const email = normalizeEmail(str(values.email));
  return {
    email: EMAIL_RE.test(email) ? email : null,
    name: [str(values.first_name), str(values.last_name)].filter(Boolean).join(" ") || null,
    businessName: str(values.legal_business_name) || null,
  };
}

function tokenMatches(draft: Draft, token: string) {
  const a = Buffer.from(draft.tokenHash, "hex");
  const b = Buffer.from(hash(token), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The draft, if the ref is genuine. */
export async function getDraft(ref: DraftRef): Promise<Draft | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(drafts).where(eq(drafts.id, ref.id)).limit(1);
  return row && tokenMatches(row, ref.token) ? row : undefined;
}

/**
 * Save progress. Creates the draft on first save. Returns the ref to keep and
 * whether the applicant's email is new or changed (so Lead Alchemist can be told).
 * Submitted drafts aren't touched.
 */
export async function saveDraft(
  form: FormDefinition,
  input: { ref?: DraftRef | null; values: FormValues; step: number },
): Promise<{ ref: DraftRef; draft: Draft; emailChanged: boolean } | null> {
  const db = await getDb();
  const { signature: _sig, ...rest } = pruneValues(form, input.values);
  void _sig;
  const step = Math.max(0, Math.min(Math.floor(input.step) || 0, form.sections.length - 1));
  const fields = { ...summary(rest), values: rest, step, updatedAt: new Date() };

  if (input.ref) {
    const existing = await getDraft(input.ref);
    if (existing && existing.formSlug === form.slug) {
      if (existing.status !== "started") return null;
      const [draft] = await db.update(drafts).set(fields).where(eq(drafts.id, existing.id)).returning();
      return { ref: input.ref, draft, emailChanged: !!draft.email && draft.email !== existing.email };
    }
  }
  const token = randomBytes(24).toString("base64url");
  const [draft] = await db
    .insert(drafts)
    .values({ ...fields, tokenHash: hash(token), formSlug: form.slug })
    .returning();
  return { ref: { id: draft.id, token }, draft, emailChanged: !!draft.email };
}

/** Called when the application is submitted: the draft stops counting as unfinished. */
export async function markDraftSubmitted(ref: DraftRef, applicationId: string): Promise<Draft | undefined> {
  const existing = await getDraft(ref);
  if (!existing || existing.status !== "started") return undefined;
  const db = await getDb();
  const [draft] = await db
    .update(drafts)
    .set({ status: "submitted", applicationId, updatedAt: new Date() })
    .where(eq(drafts.id, existing.id))
    .returning();
  return draft;
}

export async function setDraftGhlContact(id: string, contactId: string) {
  const db = await getDb();
  await db.update(drafts).set({ ghlContactId: contactId }).where(eq(drafts.id, id));
}

export async function markResumeEmailed(id: string) {
  const db = await getDb();
  await db.update(drafts).set({ resumeEmailedAt: new Date() }).where(eq(drafts.id, id));
}

/** Unfinished applications that have an email (anonymous ones can't be followed up), newest first. */
export async function listUnfinished(limit = 200): Promise<Draft[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(drafts)
    .where(eq(drafts.status, "started"))
    .orderBy(desc(drafts.updatedAt))
    .limit(limit);
  return rows.filter((d) => d.email);
}

export async function getDraftById(id: string): Promise<Draft | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(drafts).where(eq(drafts.id, id)).limit(1);
  return row;
}

export async function deleteDraft(id: string) {
  const db = await getDb();
  await db.delete(drafts).where(and(eq(drafts.id, id), eq(drafts.status, "started")));
}
