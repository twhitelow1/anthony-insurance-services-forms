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
  createOpportunity,
  findOpenOpportunities,
  listPipelines,
  type GhlPipeline,
  listCustomFields,
  updateOpportunity,
  removeTags,
  updateContact,
  upsertContact,
} from "./client";
import { applicantPath } from "@/lib/applications/links";

/**
 * GHL holds the contact (plus an opportunity), not the application. These
 * custom fields (create them in GHL as single-line text) point staff back to
 * the portal. Matching is by name and ignores case/spacing/punctuation.
 */
export const PORTAL_FIELDS = {
  reference: "Application Reference",
  status: "Application Status",
  link: "Application Link",
  pdf: "Application PDF",
} as const;

/**
 * Opportunity pipeline. GHL_PIPELINE_ID + GHL_PIPELINE_STAGE_ID (the stage new
 * applications land in) turn opportunities on. GHL_STAGE_IDS optionally maps
 * portal statuses to stages, e.g. {"in_review":"<stage>","quoted":"<stage>"},
 * so a status change moves the opportunity. Each value may be GHL's ID or the
 * pipeline/stage name as shown in GHL (see resolvePipeline).
 */
export function pipelineConfig() {
  const pipelineId = process.env.GHL_PIPELINE_ID;
  const initialStage = process.env.GHL_PIPELINE_STAGE_ID;
  if (!pipelineId || !initialStage) return null;
  let stages: Partial<Record<ApplicationStatus, string>> = {};
  try {
    stages = JSON.parse(process.env.GHL_STAGE_IDS || "{}");
  } catch {
    console.warn("[ghl] GHL_STAGE_IDS is not valid JSON — ignoring");
  }
  return { pipelineId, initialStage, stages };
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
 * The configured pipeline and stages as GHL IDs. Settings may hold IDs or the
 * names shown in GHL ("Applications" / "Application Submitted"); names are
 * looked up in the location's pipelines. Throws a readable error if one isn't found.
 */
export async function resolvePipeline() {
  const cfg = pipelineConfig();
  if (!cfg) return null;
  const pipelines = await cachedPipelines();
  const pipeline = pipelines.find((p) => matches(p, cfg.pipelineId));
  if (!pipeline) {
    throw new Error(
      `GHL_PIPELINE_ID "${cfg.pipelineId}" doesn't match any pipeline. Available: ${pipelines.map((p) => p.name).join(", ") || "none"}`,
    );
  }
  const stageId = (value: string, setting: string) => {
    const stage = (pipeline.stages ?? []).find((s) => matches(s, value));
    if (!stage) {
      throw new Error(
        `${setting} "${value}" isn't a stage of "${pipeline.name}". Stages: ${(pipeline.stages ?? []).map((s) => s.name).join(", ") || "none"}`,
      );
    }
    return stage.id;
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
 * New submission → create/update the contact, tag it, link the application and
 * its PDF, open an opportunity (if a pipeline is configured), and leave a short note.
 */
export async function syncNewApplication(
  form: FormDefinition,
  app: Application,
  pdfUrl?: string,
): Promise<{ contactId: string; opportunityId?: string; opportunityReused?: boolean; missingFields: string[] }> {
  const fields = await listCustomFields();
  const custom = portalCustomFields(app, fields, pdfUrl);
  const missingFields = Object.values(PORTAL_FIELDS).filter((n) => !findField(fields, n));

  const { contact } = await upsertContact({
    ...standardContactFields(form, app.values),
    source: form.source,
    tags: [...form.tags, statusTag(app.status)],
    customFields: custom,
  });

  await addContactNote(
    contact.id,
    [
      `📋 New ${form.title} — ${app.reference}`,
      app.businessName ? `Business: ${app.businessName}` : null,
      `Open the full application: ${adminUrl(app)}`,
      pdfUrl ? `Application PDF (staff sign-in required): ${pdfUrl}` : null,
      `All applications from ${app.applicantEmail}: ${appBase()}${applicantPath(app.applicantEmail)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  let opportunityId: string | undefined;
  let opportunityReused = false;
  const pipe = await resolvePipeline();
  if (pipe && !app.ghlOpportunityId) {
    const stage = pipe.stages[app.status] ?? pipe.initialStage;
    // The lead usually already has an open opportunity (from the quote request):
    // move it to the "application submitted" stage instead of opening a duplicate.
    const [existing] = await findOpenOpportunities(contact.id, pipe.pipelineId).catch((err) => {
      console.warn("[ghl] opportunity search failed; creating a new one", err);
      return [];
    });
    if (existing) {
      await updateOpportunity(existing.id, { pipelineStageId: stage });
      opportunityId = existing.id;
      opportunityReused = true;
    } else {
      const { opportunity } = await createOpportunity({
        pipelineId: pipe.pipelineId,
        pipelineStageId: stage,
        name: `${app.businessName ?? app.applicantName} — ${form.title} (${app.reference})`,
        contactId: contact.id,
        source: form.source,
      });
      opportunityId = opportunity.id;
    }
  }
  return { contactId: contact.id, opportunityId, opportunityReused, missingFields };
}

/** Status changed in the portal → mirror it on the contact so GHL workflows can react. */
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
    if (stage || OPP_STATUS[app.status] || OPP_STATUS[previous]) {
      await updateOpportunity(app.ghlOpportunityId, { ...(stage ? { pipelineStageId: stage } : {}), status });
    }
  }
}
