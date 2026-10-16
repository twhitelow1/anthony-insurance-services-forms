import "server-only";
import type { Application } from "@/lib/db/schema";
import { STATUSES, type ApplicationStatus } from "@/lib/applications/status";
import type { FormDefinition, FormValues } from "@/lib/forms/types";
import { isInputField } from "@/lib/forms/types";
import {
  type GhlCustomField,
  type UpsertContactInput,
  addContactNote,
  addTags,
  createCustomField,
  createOpportunity,
  findOpenOpportunities,
  getContact,
  GhlError,
  listPipelines,
  type GhlPipeline,
  type GhlOpportunity,
  listCustomFields,
  updateOpportunity,
  removeTags,
  updateContact,
  upsertContact,
} from "./client";
import { applicantPath } from "@/lib/applications/links";
import { getSettings } from "@/lib/settings";

/**
 * Lead Alchemist holds the contact (plus an opportunity), not the application. These
 * custom fields (create them in Lead Alchemist as single-line text) point staff back to
 * the portal. Matching is by name and ignores case/spacing/punctuation.
 */
export const PORTAL_FIELDS = {
  reference: "Application Reference",
  status: "Application Status",
  link: "Application Link",
  pdf: "Application PDF",
} as const;

/**
 * Opportunity pipeline, set in Admin → Settings (else GHL_PIPELINE_ID and
 * friends in Vercel). The pipeline + the stage new applications land in turn
 * opportunities on: every application gets its own opportunity there. The
 * status → stage map optionally moves the opportunity when the status changes.
 *
 * The lead pipeline (optional, plus a lead stage to narrow it to one stage)
 * is where leads wait before applying. When an application lands, the
 * lead's open opportunity there is moved into the applications pipeline and
 * becomes that application's opportunity, so the lead leaves the lead pipeline.
 *
 * Each value may be Lead Alchemist's ID or the pipeline/stage name as shown in Lead Alchemist (see resolvePipeline).
 */
export async function pipelineConfig() {
  const s = await getSettings();
  if (!s.ghlPipeline || !s.ghlPipelineStage) return null;
  return {
    pipelineId: s.ghlPipeline,
    initialStage: s.ghlPipelineStage,
    stages: s.ghlStageMap,
    leadPipeline: s.ghlLeadPipeline || null,
    leadStage: s.ghlLeadStage || null,
  };
}

/** True when `value` names `item` by ID or by name (ignoring case, spaces and punctuation). */
const matches = (item: { id: string; name: string }, value: string) =>
  item.id === value.trim() || normalize(item.name) === normalize(value);

let pipelinesCache: { at: number; list: Promise<GhlPipeline[]> } | null = null;
const cachedPipelines = () => {
  if (!pipelinesCache || Date.now() - pipelinesCache.at > 10 * 60_000) {
    pipelinesCache = { at: Date.now(), list: listPipelines() };
    pipelinesCache.list.catch(() => (pipelinesCache = null));
  }
  return pipelinesCache.list;
};

/**
 * The configured pipeline and stages as Lead Alchemist IDs. Settings may hold IDs or the
 * names shown in Lead Alchemist ("Applications" / "Application Submitted"); names are
 * looked up in the location's pipelines. Throws a readable error if one isn't found.
 */
export async function resolvePipeline() {
  const cfg = await pipelineConfig();
  if (!cfg) return null;
  const pipelines = await cachedPipelines();
  const findPipeline = (value: string, setting: string) => {
    const found = pipelines.find((p) => matches(p, value));
    if (!found) {
      throw new Error(`${setting} "${value}" doesn't match any pipeline. Available: ${pipelines.map((p) => p.name).join(", ") || "none"}`);
    }
    return found;
  };
  const findStage = (pipeline: GhlPipeline, value: string, setting: string) => {
    const stage = (pipeline.stages ?? []).find((s) => matches(s, value));
    if (!stage) {
      throw new Error(
        `${setting} "${value}" isn't a stage of "${pipeline.name}". Stages: ${(pipeline.stages ?? []).map((s) => s.name).join(", ") || "none"}`,
      );
    }
    return stage.id;
  };
  const pipeline = findPipeline(cfg.pipelineId, "GHL_PIPELINE_ID");
  const leadPipeline = cfg.leadPipeline ? findPipeline(cfg.leadPipeline, "GHL_LEAD_PIPELINE_ID") : null;
  const lead = leadPipeline
    ? {
        pipelineId: leadPipeline.id,
        pipelineName: leadPipeline.name,
        stageId: cfg.leadStage ? findStage(leadPipeline, cfg.leadStage, "GHL_LEAD_STAGE_ID") : null,
      }
    : null;
  const stageId = (value: string, setting: string) => {
    return findStage(pipeline, value, setting);
  };
  const stages: Partial<Record<ApplicationStatus, string>> = {};
  for (const [status, value] of Object.entries(cfg.stages)) {
    if (typeof value === "string" && value.trim()) stages[status as ApplicationStatus] = stageId(value, `GHL_STAGE_IDS.${status}`);
  }
  return {
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    initialStage: stageId(cfg.initialStage, "GHL_PIPELINE_STAGE_ID"),
    stages,
    lead,
  };
}

/** Opportunity status for terminal portal statuses. */
const OPP_STATUS: Partial<Record<ApplicationStatus, "won" | "lost" | "abandoned">> = {
  bound: "won",
  declined: "lost",
  withdrawn: "abandoned",
};

export const statusTag = (s: ApplicationStatus) => `app-status:${s}`;

export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function findField(fields: GhlCustomField[], name: string): GhlCustomField | undefined {
  const n = normalize(name);
  return fields.find((f) => normalize(f.name) === n || normalize(f.fieldKey.replace(/^contact\./, "")) === n);
}

const appBase = () => (process.env.APP_URL ?? "").replace(/\/$/, "");
export const adminUrl = (app: Pick<Application, "id">) => `${appBase()}/admin/applications/${app.id}`;

/** Standard contact fields copied from the answers (fields marked `ghl.standard`). */
export function standardContactFields(form: FormDefinition, values: FormValues): UpsertContactInput {
  const out: UpsertContactInput = {};
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!isInputField(field) || !field.ghl) continue;
      const v = values[field.id];
      if (typeof v === "string" && v.trim()) out[field.ghl.standard] = v.trim();
    }
  }
  return out;
}

const str = (v: FormValues[string]) => (typeof v === "string" ? v.trim() : "");
const usDate = (iso: string) => iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3/$1");

/**
 * The note added to the contact for each application. Contact custom fields only hold the
 * latest application, so this note (and the application's own opportunity) is the per-application
 * record in Lead Alchemist. Links only: the answers stay in the app.
 */
export function applicationNote(
  form: Pick<FormDefinition, "title">,
  app: Pick<Application, "id" | "reference" | "status" | "businessName" | "applicantName" | "applicantEmail" | "state" | "values" | "createdAt" | "isTest">,
  pdfUrl?: string,
) {
  const effective = str(app.values.requested_effective_date);
  const submitted = new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.APP_TIMEZONE ?? "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(app.createdAt));
  return [
    `📋 ${app.isTest ? "[TEST] " : ""}${form.title} — ${app.reference}`,
    `Submitted: ${submitted}`,
    `Status: ${STATUSES[app.status].label}`,
    app.businessName ? `Business: ${app.businessName}` : null,
    `Applicant: ${[app.applicantName, app.applicantEmail, str(app.values.phone)].filter(Boolean).join(" · ")}`,
    app.state ? `State: ${app.state}` : null,
    effective ? `Requested effective date: ${usDate(effective)}` : null,
    "",
    `Open the application: ${adminUrl(app)}`,
    pdfUrl ? `Application PDF (staff sign-in required): ${pdfUrl}` : null,
    `All applications from ${app.applicantEmail}: ${appBase()}${applicantPath(app.applicantEmail)}`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/**
 * The opportunity custom fields that carry each application's reference, status, link and
 * PDF on its card. Missing ones are created once (needs the "Edit Custom Fields" scope);
 * anything still missing is reported so staff can add it by hand.
 */
let opportunityFieldsOnce: Promise<{ fields: GhlCustomField[]; missing: string[] }> | null = null;
export const resetOpportunityFieldCache = () => (opportunityFieldsOnce = null);

async function opportunityFields(): Promise<{ fields: GhlCustomField[]; missing: string[] }> {
  const fields = await listCustomFields("opportunity").catch((err) => {
    console.warn("[ghl] couldn't list opportunity custom fields", err);
    return [] as GhlCustomField[];
  });
  const absent = Object.values(PORTAL_FIELDS).filter((n) => !findField(fields, n));
  if (!absent.length) return { fields, missing: [] };
  opportunityFieldsOnce ??= (async () => {
    const created: GhlCustomField[] = [];
    const missing: string[] = [];
    for (const name of absent) {
      try {
        created.push(await createCustomField(name, "opportunity"));
      } catch (err) {
        console.warn(`[ghl] couldn't create the opportunity field "${name}"`, err);
        missing.push(name);
      }
    }
    return { fields: created, missing };
  })();
  const made = await opportunityFieldsOnce;
  // A failed attempt is retried on a later submission (the token's scopes may have been fixed).
  if (made.missing.length) opportunityFieldsOnce = null;
  return { fields: [...fields, ...made.fields], missing: made.missing };
}

export function portalCustomFields(
  app: Pick<Application, "id" | "reference" | "status">,
  fields: GhlCustomField[],
  pdfUrl?: string,
): { id: string; field_value: string }[] {
  const wanted: [string, string][] = [
    [PORTAL_FIELDS.reference, app.reference],
    [PORTAL_FIELDS.status, STATUSES[app.status].label],
    [PORTAL_FIELDS.link, adminUrl(app)],
    ...(pdfUrl ? ([[PORTAL_FIELDS.pdf, pdfUrl]] as [string, string][]) : []),
  ];
  return wanted.flatMap(([name, value]) => {
    const f = findField(fields, name);
    return f ? [{ id: f.id, field_value: value }] : [];
  });
}

/**
 * The applicant's Lead Alchemist contact, created or updated. A contact ID saved from an
 * earlier sync wins, so later applications land on the same contact even if
 * staff edited it in Lead Alchemist; otherwise Lead Alchemist matches on email (upsert).
 */
/**
 * Lead Alchemist refuses an update that would give this contact the phone (or email)
 * of a different contact: "This location does not allow duplicated contacts."
 * Returns that field's name so the update can be retried without it.
 */
export function duplicateField(err: unknown): string | null {
  if (!(err instanceof GhlError) || err.status !== 400) return null;
  const body = err.body as { message?: unknown; meta?: { matchingField?: unknown } } | null;
  if (typeof body?.message !== "string" || !/duplicated contacts/i.test(body.message)) return null;
  return typeof body.meta?.matchingField === "string" ? body.meta.matchingField : null;
}

/** Run a contact write; if a field clashes with another contact, drop it and try once more. */
async function withoutDuplicates<T, I extends Record<string, unknown>>(input: I, write: (input: I) => Promise<T>): Promise<T> {
  try {
    return await write(input);
  } catch (err) {
    const field = duplicateField(err);
    if (!field || !(field in input)) throw err;
    console.warn(`[ghl] ${field} belongs to another Lead Alchemist contact; saved without it`);
    const { [field]: _dropped, ...rest } = input;
    void _dropped;
    return write(rest as I);
  }
}

async function syncContact(
  form: FormDefinition,
  values: FormValues,
  tags: string[],
  customFields: { id: string; field_value: string }[],
  savedId?: string | null,
): Promise<{ contactId: string; matchedBy: "saved_id" | "email" }> {
  const fields = standardContactFields(form, values);
  if (savedId) {
    try {
      // Email is left alone: it's what links them, and staff may have changed it in Lead Alchemist on purpose.
      const { email: _email, ...rest } = fields;
      void _email;
      await withoutDuplicates({ ...rest, customFields }, (input) => updateContact(savedId, input));
      await addTags(savedId, tags);
      return { contactId: savedId, matchedBy: "saved_id" };
    } catch (err) {
      // Deleted or merged away in Lead Alchemist → fall back to matching on email. Anything else is a real error.
      const gone = err instanceof GhlError && (err.status === 400 || err.status === 404) && !(await getContact(savedId));
      if (!gone) throw err;
    }
  }
  const { contact } = await withoutDuplicates({ ...fields, source: form.source, tags, customFields }, upsertContact);
  return { contactId: contact.id, matchedBy: "email" };
}

/** Tags that mark an unfinished application, for Lead Alchemist follow-up workflows. */
export const startedTags = (form: FormDefinition) => ["app-started", `app-started:${form.slug}`];

/**
 * An applicant started a form and gave their email: create/update their contact
 * and tag it "app-started" so Lead Alchemist can follow up if they don't finish.
 */
export async function syncStartedApplication(form: FormDefinition, values: FormValues, savedContactId?: string | null) {
  return syncContact(form, values, [...form.tags, ...startedTags(form)], [], savedContactId);
}

/**
 * New submission → create/update the contact, tag it, link the application and
 * its PDF, open or move an opportunity (if a pipeline is configured), and leave a short note.
 */
export async function syncNewApplication(
  form: FormDefinition,
  app: Application,
  pdfUrl?: string,
  /** Lead Alchemist contact ID saved for this applicant's email (applicants table), if any. */
  savedContactId?: string | null,
): Promise<{
  contactId: string;
  matchedBy: "saved_id" | "email";
  opportunityId?: string;
  /** True when the lead's opportunity was moved over from the lead pipeline. */
  movedFromLead?: boolean;
  missingFields: string[];
  missingOpportunityFields?: string[];
}> {
  const fields = await listCustomFields();
  const custom = portalCustomFields(app, fields, pdfUrl);
  const missingFields = Object.values(PORTAL_FIELDS).filter((n) => !findField(fields, n));

  const { contactId, matchedBy } = await syncContact(
    form,
    app.values,
    // Testing-mode submissions are tagged so they're easy to find and delete in Lead Alchemist.
    [...form.tags, statusTag(app.status), ...(app.isTest ? ["test"] : [])],
    custom,
    savedContactId,
  );
  // They finished: stop the "started but not submitted" follow-ups.
  await removeTags(contactId, startedTags(form)).catch((err) => console.warn("[ghl] couldn't remove started tags", err));

  await addContactNote(contactId, applicationNote(form, app, pdfUrl));

  let opportunityId: string | undefined;
  let movedFromLead = false;
  let missingOpportunityFields: string[] = [];
  const pipe = await resolvePipeline();
  if (pipe && !app.ghlOpportunityId) {
    // Every application is its own opportunity, carrying its reference, link and PDF.
    const { fields: oppFields, missing } = await opportunityFields();
    missingOpportunityFields = missing;
    const opp = {
      pipelineId: pipe.pipelineId,
      pipelineStageId: pipe.stages[app.status] ?? pipe.initialStage,
      name: `${app.businessName ?? app.applicantName} — ${form.title} (${app.reference})`,
      customFields: portalCustomFields(app, oppFields, pdfUrl),
    };
    // A lead waiting in the lead pipeline is moved over: its opportunity becomes this
    // application's, so it leaves the lead pipeline. Later applications get new ones.
    let lead: GhlOpportunity | undefined;
    if (pipe.lead) {
      const open = await findOpenOpportunities(contactId, pipe.lead.pipelineId).catch((err) => {
        console.warn("[ghl] lead opportunity search failed", err);
        return [] as GhlOpportunity[];
      });
      lead = open.find((o) => !pipe.lead!.stageId || o.pipelineStageId === pipe.lead!.stageId);
    }
    if (lead) {
      await updateOpportunity(lead.id, opp);
      opportunityId = lead.id;
      movedFromLead = true;
    } else {
      const { opportunity } = await createOpportunity({ ...opp, contactId, source: form.source });
      opportunityId = opportunity.id;
    }
  }
  return { contactId, matchedBy, opportunityId, movedFromLead, missingFields, missingOpportunityFields };
}

/** Status changed in the portal → mirror it on the contact so Lead Alchemist workflows can react. */
export async function syncStatus(app: Application, previous: ApplicationStatus) {
  if (!app.ghlContactId) return;
  const fields = await listCustomFields();
  await updateContact(app.ghlContactId, { customFields: portalCustomFields(app, fields) });
  await addTags(app.ghlContactId, [statusTag(app.status)]);
  if (previous !== app.status) await removeTags(app.ghlContactId, [statusTag(previous)]);

  const pipe = app.ghlOpportunityId ? await resolvePipeline() : null;
  if (pipe && app.ghlOpportunityId) {
    const stage = pipe.stages[app.status];
    const status = OPP_STATUS[app.status] ?? "open";
    const oppFields = await listCustomFields("opportunity").catch(() => [] as GhlCustomField[]);
    const statusField = findField(oppFields, PORTAL_FIELDS.status);
    await updateOpportunity(app.ghlOpportunityId, {
      ...(stage ? { pipelineStageId: stage } : {}),
      ...(stage || OPP_STATUS[app.status] || OPP_STATUS[previous] ? { status } : {}),
      ...(statusField ? { customFields: [{ id: statusField.id, field_value: STATUSES[app.status].label }] } : {}),
    });
  }
}
