import "server-only";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { forms, getForm } from "@/forms";
import { getDb, schema } from "@/lib/db";
import { assignApplicationClient, ensureContact, getContactByEmail, isIndividualForm } from "@/lib/clients/repo";
import { standardContactFields } from "@/lib/ghl/sync";
import { isInputField, tableCellId, type FormDefinition, type FormValues, type GhlStandardField, type InputField } from "@/lib/forms/types";
import { laSubmissionsPage, listCustomFields, listLaSources, type LaSourceKind, type LaSubmission } from "@/lib/ghl/client";
import type { BatchResult } from "@/lib/bulk/selection-run";
import { addEvent, createImportedApplication, normalizeEmail } from "./repo";

/**
 * Import old applications: every submission of the Lead Alchemist forms (and the survey) our web
 * forms were copied from becomes an application in AIS Connect, marked "Imported from Lead
 * Alchemist", with its original date, on the right account and contact (matched by email like a
 * new application). Answers are matched to our form's questions by the Lead Alchemist field's name;
 * anything that doesn't match is kept under "Other answers from Lead Alchemist". Nothing is sent
 * anywhere (no emails, Lead Alchemist or Salesforce syncs, AI review), and each submission is
 * imported once only.
 */

/** "form:<id>" or "survey:<id>" → our form slug: the Lead Alchemist sources our forms were transcribed from. */
export const DEFAULT_SOURCES: Record<string, string> = {
  "form:FxLHdygRPQTmDs3jxH0y": "aerial-instructor-application",
  "form:YK2al1vcLOnPCt3qW1kZ": "aerial-yoga-studio-application",
  "form:okKpbcPIEgUykRJQy2QE": "camp-clinic-application",
  "form:QtRy9zJIG8EanS6C4xyo": "equipment-floater-application",
  "form:4DPE8U76f8NuMA1dZV9M": "group-vendor-liability-application",
  "form:BQxQ2q2nDqbqUQrKOX9U": "leisure-sport-equipment-application",
  "survey:Bt8KGBOGa5n7THVJuqsY": "martial-arts-event-application",
  "form:cxjHXnrzqLgvYRk6Vme9": "martial-arts-instructor-application",
  "form:ZyanGA4wMPk3RcUjFsW5": "special-event-application",
  "form:pkfFEJ14mVIBrytwX7g5": "sport-event-application",
  "form:2rfgPVPlD4jV4cvjczTY": "sports-facility-application",
  "form:XMURWOwptJyzSHt4WA3d": "gymnastics-application",
};

const MAP_KEY = "la_import_sources";
/** Kept in `values` for answers that matched none of the form's questions ("Label: answer" lines). */
export const OTHER_ANSWERS = "_la_other_answers";

/** Which of our forms each Lead Alchemist form or survey goes into ("" = don't import it). */
export async function importSourceMap(): Promise<Record<string, string>> {
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, MAP_KEY)).limit(1);
  return { ...DEFAULT_SOURCES, ...((row?.value as Record<string, string>) ?? {}) };
}

export async function saveImportSourceMap(map: Record<string, string>, actor: string) {
  const clean = Object.fromEntries(Object.entries(map).filter(([k, v]) => /^(form|survey):[A-Za-z0-9]{6,64}$/.test(k) && (v === "" || getForm(v))));
  const db = await getDb();
  await db
    .insert(schema.appSettings)
    .values({ key: MAP_KEY, value: clean, updatedBy: actor })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: clean, updatedBy: actor, updatedAt: new Date() } });
}

export interface ImportSource {
  key: string;
  kind: LaSourceKind;
  id: string;
  name: string;
  slug: string;
  submissions: number | null;
}

/** Every Lead Alchemist form and survey, with how many submissions each has and where they'd go. */
export async function listImportSources(): Promise<{ sources: ImportSource[]; imported: Record<string, number> }> {
  const map = await importSourceMap();
  const [formsList, surveys] = await Promise.all([listLaSources("form"), listLaSources("survey")]);
  const all = [...formsList.map((f) => ({ ...f, kind: "form" as const })), ...surveys.map((f) => ({ ...f, kind: "survey" as const }))];
  const sources: ImportSource[] = [];
  for (const s of all) {
    const key = `${s.kind}:${s.id}`;
    const slug = map[key] ?? "";
    // Counting costs a request each, so only for the ones being imported.
    const submissions = slug ? await laSubmissionsPage(s.kind, s.id, 1, 1).then((r) => r.total).catch(() => null) : null;
    sources.push({ key, kind: s.kind, id: s.id, name: s.name, slug, submissions });
  }
  sources.sort((a, b) => Number(!a.slug) - Number(!b.slug) || a.name.localeCompare(b.name));
  const db = await getDb();
  const rows = await db
    .select({ slug: schema.applications.formSlug, n: count() })
    .from(schema.applications)
    .where(eq(schema.applications.importedFrom, "lead_alchemist"))
    .groupBy(schema.applications.formSlug);
  return { sources, imported: Object.fromEntries(rows.map((r) => [r.slug, Number(r.n)])) };
}

const PAGE = 100;

/**
 * The work items of an import run: one per page of submissions ("form:<id>:<page>"), for every
 * Lead Alchemist form set to import, or only the ones in `only` (ticked on the page).
 */
export async function importRunIds(only?: string[]): Promise<string[]> {
  const map = await importSourceMap();
  const ids: string[] = [];
  for (const [key, slug] of Object.entries(map)) {
    if (!slug || !getForm(slug)) continue;
    if (only && !only.includes(key)) continue;
    const [kind, id] = key.split(":") as [LaSourceKind, string];
    const { total } = await laSubmissionsPage(kind, id, 1, 1);
    for (let p = 1; p <= Math.ceil(total / PAGE); p++) ids.push(`${key}:${p}`);
  }
  return ids;
}

// ── Mapping one submission onto a form ─────────────────────────────────

/** Lead Alchemist's names for the built-in fields our forms copy to (see GhlStandardField). */
const STANDARD_KEYS: Record<GhlStandardField, string[]> = {
  firstName: ["first_name"],
  lastName: ["last_name"],
  email: ["email"],
  phone: ["phone"],
  website: ["website"],
  address1: ["address1", "address"],
  city: ["city"],
  state: ["state"],
  postalCode: ["postal_code"],
  companyName: ["company_name", "companyName"],
};
const META = new Set(["eventData", "fieldsOriSequance", "fieldsOriSequence", "full_name", "signature", "terms_and_conditions", "sessionId", "Timezone", "ip", "formId", "surveyId", "contactId"]);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]/g, "");

const textOf = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // File uploads: { <id>: { url, meta: { originalname } } } or { url }.
    if (typeof o.url === "string") return o.url;
    return Object.values(o).map(textOf).filter(Boolean).join(", ");
  }
  return String(v).trim();
};

/** A Lead Alchemist answer as our field stores it: options by their value, lists for checkboxes. */
function toFieldValue(field: InputField, v: unknown): string | string[] | undefined {
  if (field.type === "checkboxes") {
    const parts = (Array.isArray(v) ? v.map(textOf) : textOf(v).split(/\s*,\s*/)).filter(Boolean);
    return parts.map((p) => field.options.find((o) => o.value.toLowerCase() === p.toLowerCase() || o.label.toLowerCase() === p.toLowerCase())?.value ?? p);
  }
  const t = textOf(v);
  if (!t) return undefined;
  if (field.type === "select" || field.type === "radio") {
    return field.options.find((o) => o.value.toLowerCase() === t.toLowerCase() || o.label.toLowerCase() === t.toLowerCase())?.value ?? t;
  }
  return t;
}

export interface MappedSubmission {
  values: FormValues;
  /** "Label: answer" for answers no question of the form matched. */
  other: string[];
  email: string | null;
  name: string;
}

/** Match a submission's answers to the form's questions. `fieldNames`: Lead Alchemist custom field ID (and key) → its name. */
export function mapSubmission(form: FormDefinition, sub: LaSubmission, fieldNames: Map<string, string>): MappedSubmission {
  const inputs = form.sections.flatMap((s) => s.fields).filter(isInputField).filter((f) => f.type !== "signature" && f.type !== "file");
  const byStandard = new Map<string, InputField>();
  for (const f of inputs) if (f.ghl) for (const k of STANDARD_KEYS[f.ghl.standard]) byStandard.set(k, f);
  // Several questions can share a label ("State" for the mailing and the event address): the first one still empty.
  const byLabel = new Map<string, InputField[]>();
  for (const f of inputs) byLabel.set(norm(f.label), [...(byLabel.get(norm(f.label)) ?? []), f]);
  // Table cells by "<table label> <column label>" (first row only, as old forms had one).
  const tableCells = new Map<string, string>();
  for (const s of form.sections)
    for (const f of s.fields) if (f.type === "table") for (const c of f.columns) tableCells.set(norm(`${f.label} ${c.label}`), tableCellId(f.id, 1, c.id));

  const values: FormValues = {};
  const other: string[] = [];
  const others = sub.others ?? {};
  for (const [key, raw] of Object.entries(others)) {
    if (key.startsWith("__") || META.has(key)) continue;
    const field = byStandard.get(key);
    const label = fieldNames.get(key) ?? fieldNames.get(`contact.${key}`) ?? key.replace(/_/g, " ");
    const target = field ?? byLabel.get(norm(label))?.find((f) => values[f.id] === undefined);
    if (target) {
      const v = toFieldValue(target, raw);
      if (v !== undefined && (typeof v === "string" ? v : v.length)) values[target.id] = v;
      continue;
    }
    const cell = tableCells.get(norm(label));
    const t = textOf(raw);
    if (cell && t) {
      values[cell] = t;
      continue;
    }
    if (t) other.push(`${label}: ${t}`);
  }

  // The person: built-in fields first, else what the submission itself says.
  const full = textOf(others.full_name) || textOf(sub.name);
  if (!values.first_name && !values.last_name && full) {
    const [first, ...rest] = full.split(/\s+/);
    values.first_name = first;
    if (rest.length) values.last_name = rest.join(" ");
  }
  const email = textOf(values.email) || textOf(others.email) || textOf(sub.email);
  if (email) values.email = email;
  if (other.length) values[OTHER_ANSWERS] = other;
  const name = [textOf(values.first_name), textOf(values.last_name)].filter(Boolean).join(" ") || full;
  return { values, other, email: email ? normalizeEmail(email) : null, name };
}

// ── The run's work ──────────────────────────────────────────────────────

let fieldNameCache: { at: number; map: Map<string, string> } | null = null;
async function customFieldNames(): Promise<Map<string, string>> {
  if (fieldNameCache && !process.env.VITEST && Date.now() - fieldNameCache.at < 300_000) return fieldNameCache.map;
  const map = new Map<string, string>();
  for (const f of await listCustomFields("contact").catch(() => [])) {
    map.set(f.id, f.name);
    map.set(f.fieldKey, f.name);
    map.set(f.fieldKey.replace(/^contact\./, ""), f.name);
  }
  fieldNameCache = { at: Date.now(), map };
  return map;
}

/** Import one page of submissions per work item ("form:<id>:<page>"). */
export async function importSubmissionPages(items: string[], actor: string, runId?: string): Promise<BatchResult> {
  const result: BatchResult = { done: 0, notes: [] };
  const map = await importSourceMap();
  const names = await customFieldNames();
  const db = await getDb();
  for (const item of items) {
    // "<kind>:<id>:<page>", or "…:<page>:<subId>.<subId>" for just the submissions ticked on that page.
    const [kind, id, pageText, picked] = item.split(":") as [LaSourceKind, string, string, string | undefined];
    const only = picked ? new Set(picked.split(".")) : null;
    const form = getForm(map[`${kind}:${id}`] ?? "");
    if (!form) {
      result.notes.push(`${kind} ${id}: not set to import into any form any more; skipped.`);
      continue;
    }
    const submissions = (await laSubmissionsPage(kind, id, Number(pageText), PAGE)).submissions.filter((sub) => !only || only.has(sub.id));
    const seen = new Set(
      (
        await db
          .select({ id: schema.applications.laSubmissionId })
          .from(schema.applications)
          .where(and(eq(schema.applications.importedFrom, "lead_alchemist"), inArray(schema.applications.laSubmissionId, submissions.map((s) => s.id).concat("-"))))
      ).map((r) => r.id),
    );
    let made = 0;
    let already = 0;
    for (const sub of submissions) {
      if (seen.has(sub.id)) {
        already++;
        continue;
      }
      try {
        const m = mapSubmission(form, sub, names);
        if (!m.email) {
          result.notes.push(`${form.title}: a submission from ${sub.createdAt?.slice(0, 10) ?? "an unknown date"} has no email, so it wasn't imported (Lead Alchemist submission ${sub.id}).`);
          continue;
        }
        const app = await createImportedApplication(form, m.values, {
          laSubmissionId: sub.id,
          submittedAt: sub.createdAt ? new Date(sub.createdAt) : null,
          laContactId: sub.contactId ?? null,
          extraSearch: m.other,
        });
        if (!app) {
          already++;
          continue;
        }
        // On the right account and contact, as if it had just come in (Source: Lead Alchemist when new).
        const c = standardContactFields(form, m.values);
        await assignApplicationClient(app.id, {
          email: app.applicantEmail,
          firstName: c.firstName,
          lastName: c.lastName,
          contactName: app.applicantName,
          businessName: app.businessName,
          phone: c.phone,
          website: c.website,
          address: { street: c.address1, city: c.city, state: c.state, postalCode: c.postalCode },
          individual: isIndividualForm(form.slug),
          source: "lead_alchemist",
        });
        if (sub.contactId) {
          const person = await getContactByEmail(m.email);
          if (person && !person.ghlContactId) await ensureContact({ clientId: person.clientId, email: m.email, ghlContactId: sub.contactId });
        }
        await addEvent(app.id, "imported", actor, {
          message: `Imported from Lead Alchemist (${kind} submission of ${sub.createdAt?.slice(0, 10) ?? "unknown date"})${m.other.length ? `; ${m.other.length} answer(s) didn't match a question and are listed under "Other answers"` : ""}`,
          data: { laSubmissionId: sub.id, source: `${kind}:${id}`, ...(runId ? { runId } : {}) },
        });
        made++;
      } catch (err) {
        result.notes.push(`${form.title}: submission ${sub.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    result.done++;
    result.notes.push(`${form.title} (page ${pageText}): ${made} imported${already ? `, ${already} already here` : ""}.`);
  }
  return result;
}

/** The forms you can import into, for the page's dropdowns. */
export const importTargets = () => Object.values(forms).map((f) => ({ slug: f.slug, title: f.title })).sort((a, b) => a.title.localeCompare(b.title));

export interface SubmissionRow {
  id: string;
  date: string | null;
  name: string;
  email: string | null;
  /** The application it became, when already imported. */
  applicationId: string | null;
}

/** One page of a Lead Alchemist form's submissions, for picking which to import. */
export async function listSourceSubmissions(key: string, page: number): Promise<{ rows: SubmissionRow[]; total: number; pages: number }> {
  const [kind, id] = key.split(":") as [LaSourceKind, string];
  const { submissions, total } = await laSubmissionsPage(kind, id, page, PAGE);
  const db = await getDb();
  const imported = new Map(
    (
      await db
        .select({ sub: schema.applications.laSubmissionId, id: schema.applications.id })
        .from(schema.applications)
        .where(inArray(schema.applications.laSubmissionId, submissions.map((s) => s.id).concat("-")))
    ).map((r) => [r.sub, r.id] as const),
  );
  const rows = submissions.map((sub) => {
    const o = sub.others ?? {};
    const name = textOf(sub.name) || [textOf(o.first_name), textOf(o.last_name)].filter(Boolean).join(" ") || textOf(o.full_name);
    return { id: sub.id, date: sub.createdAt ?? null, name, email: textOf(sub.email) || textOf(o.email) || null, applicationId: imported.get(sub.id) ?? null };
  });
  return { rows, total, pages: Math.max(1, Math.ceil(total / PAGE)) };
}

/** The work item for submissions ticked on one page of a source. */
export const pickedItem = (key: string, page: number, ids: string[]) => `${key}:${page}:${ids.join(".")}`;

/** The imported applications that came from one Lead Alchemist form or survey (from their "imported" event). */
function fromSource(key: string) {
  return sql`${schema.applications.importedFrom} = 'lead_alchemist' and ${schema.applications.id} in (select e.application_id from ${schema.applicationEvents} e where e.type = 'imported' and e.data->>'source' = ${key})`;
}

/** How many applications each Lead Alchemist form or survey has brought in. */
export async function importedBySource(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db
    .select({ key: sql<string>`e.data->>'source'`, n: count() })
    .from(sql`${schema.applicationEvents} e`)
    .where(sql`e.type = 'imported'`)
    .groupBy(sql`e.data->>'source'`);
  return Object.fromEntries(rows.map((r) => [r.key, Number(r.n)]));
}

/**
 * Undo an import: remove from AIS Connect the applications imported from one Lead Alchemist form
 * or survey (only imported ones; nothing in Lead Alchemist or Salesforce is touched). Accounts and
 * contacts stay. Returns how many were removed.
 */
export async function undoImport(key: string): Promise<number> {
  const db = await getDb();
  const removed = await db.delete(schema.applications).where(fromSource(key)).returning({ id: schema.applications.id });
  return removed.length;
}

export interface ImportedRow {
  id: string;
  reference: string;
  submittedAt: Date;
  applicantName: string;
  applicantEmail: string;
  businessName: string | null;
  clientId: string | null;
  accountName: string | null;
  formSlug: string;
}

/** The applications one Lead Alchemist form or survey brought in, newest first (100 a page). */
export async function listImportedFromSource(key: string, page = 1): Promise<{ rows: ImportedRow[]; total: number }> {
  const db = await getDb();
  const a = schema.applications;
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: a.id,
        reference: a.reference,
        submittedAt: a.createdAt,
        applicantName: a.applicantName,
        applicantEmail: a.applicantEmail,
        businessName: a.businessName,
        clientId: a.clientId,
        accountName: schema.clients.name,
        formSlug: a.formSlug,
      })
      .from(a)
      .leftJoin(schema.clients, eq(schema.clients.id, a.clientId))
      .where(fromSource(key))
      .orderBy(sql`${a.createdAt} desc`)
      .limit(PAGE)
      .offset((Math.max(1, page) - 1) * PAGE),
    db.select({ total: count() }).from(a).where(fromSource(key)),
  ]);
  return { rows, total: Number(total) };
}

export interface ImportRunSummary {
  /** The run's ID, or "legacy:<actor>:<day>" for imports made before runs were recorded. */
  key: string;
  startedAt: Date;
  endedAt: Date;
  actor: string;
  applications: number;
  sources: string[];
}

/** Where an import run's applications are, by its key (see ImportRunSummary). */
function fromRun(key: string) {
  if (key.startsWith("legacy:")) {
    const [, actor, day] = key.match(/^legacy:(.*):(\d{4}-\d{2}-\d{2})$/) ?? [];
    return sql`${schema.applications.importedFrom} = 'lead_alchemist' and ${schema.applications.id} in (select e.application_id from ${schema.applicationEvents} e where e.type = 'imported' and e.data->>'runId' is null and e.actor = ${actor ?? ""} and to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD') = ${day ?? ""})`;
  }
  return sql`${schema.applications.importedFrom} = 'lead_alchemist' and ${schema.applications.id} in (select e.application_id from ${schema.applicationEvents} e where e.type = 'imported' and e.data->>'runId' = ${key})`;
}

/** Every import run that still has applications in AIS Connect, newest first. */
export async function listImportRuns(): Promise<ImportRunSummary[]> {
  const db = await getDb();
  const rows = await db.execute(sql`
    select coalesce(e.data->>'runId', 'legacy:' || e.actor || ':' || to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD')) as key,
      min(e.created_at) as started, max(e.created_at) as ended, min(e.actor) as actor, count(*) as n,
      array_agg(distinct e.data->>'source') as sources
    from ${schema.applicationEvents} e
    join ${schema.applications} a on a.id = e.application_id and a.imported_from = 'lead_alchemist'
    where e.type = 'imported'
    group by 1
    order by min(e.created_at) desc
    limit 100`);
  const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as {
    key: string;
    started: string | Date;
    ended: string | Date;
    actor: string;
    n: number | string;
    sources: string[] | string | null;
  }[];
  return list.map((r) => ({
    key: r.key,
    startedAt: new Date(r.started),
    endedAt: new Date(r.ended),
    actor: r.actor,
    applications: Number(r.n),
    sources: Array.isArray(r.sources) ? r.sources.filter(Boolean) : typeof r.sources === "string" ? r.sources.replace(/[{}"]/g, "").split(",").filter(Boolean) : [],
  }));
}

/** Reverse one import run: remove the applications it brought into AIS Connect (nothing else changes). */
export async function reverseImportRun(key: string): Promise<number> {
  const db = await getDb();
  const removed = await db.delete(schema.applications).where(fromRun(key)).returning({ id: schema.applications.id });
  return removed.length;
}
