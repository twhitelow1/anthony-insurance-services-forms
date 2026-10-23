import type { FormValues } from "@/lib/forms/types";
import type { ApplicationStatus } from "@/lib/applications/status";
import { parseMoney } from "@/lib/forms/helpers";
import type { FieldDescribe, ObjectDescribe } from "./api";

/**
 * What goes where in Salesforce. Everything is checked against the org's own describe
 * before writing: a field that doesn't exist, or a picklist value the org doesn't have,
 * is skipped and reported instead of failing the sync. Extend the tables below.
 */

/** The three-way link fields (URL(255)) the app fills. Missing ones are skipped and shown in Settings. */
export const LINK_FIELDS = {
  Account: {
    applications: "Applications_Link__c",
    laCompany: "LA_Company_Link__c",
    laContact: "LA_Contact_Link__c",
    laOpportunity: "LA_Opportunity_Link__c",
  },
  Contact: {
    laContact: "LA_Contact_Link__c",
    applications: "Applications_Link__c",
  },
  Opportunity: {
    laOpportunity: "LA_Opportunity_Link__c",
    application: "Application_Link__c",
  },
} as const;

/** Form → Program__c picklist value(s) to try, in order. Only a value the org's picklist has is written. */
export const PROGRAM_BY_FORM: Record<string, string[]> = {
  "aerial-instructor-application": ["Aerial Instructor"],
  "aerial-yoga-studio-application": ["Aerial Yoga Studio", "Aerial Studio", "Aerial Yoga"],
  "aerial-dance-studio-application": ["Aerial Dance Studio", "Aerial Studio", "Aerial Dance"],
  "fitness-facility-application": ["Fitness Class & Cross Training", "Fitness Class / Health Club A", "Fitness Studio", "Fitness"],
  "gymnastics-application": ["Gymnastics"],
  "sports-facility-application": ["Sports Facility"],
  "boxing-gym-application": ["Boxing Gym", "Boxing"],
  "martial-arts-instructor-application": ["Martial Arts Instructor"],
  "martial-arts-event-application": ["Martial Arts Event", "MMA Events"],
  "camp-clinic-application": ["Camp / Clinic", "Camps & Clinics", "Camp"],
  "special-event-application": ["Special Event"],
  "sport-event-application": ["Sport Event", "Sports Event"],
  "larp-event-application": ["LARP", "LARP Event"],
  "group-vendor-liability-application": ["Group Vendor Liability", "Vendor Liability"],
  "equipment-floater-application": ["Equipment Floater", "Inland Marine"],
  "leisure-sport-equipment-application": ["Leisure Sport Equipment", "Equipment Floater"],
};

/** Forms filled in by one person insuring themselves: their Account is an individual. */
export const INDIVIDUAL_FORMS = new Set(["aerial-instructor-application", "martial-arts-instructor-application"]);

const str = (v: FormValues[string]) => (typeof v === "string" ? v.trim() : "");
const num = (v: FormValues[string]) => {
  const n = typeof v === "string" ? Number(v.replace(/[,\s]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The participant count, whichever way the form asks for it. */
export function participants(values: FormValues): number | null {
  for (const id of ["number_of_participants", "total_participants", "participants_busiest_month"]) {
    const n = num(values[id]);
    if (n !== null) return n;
  }
  const youth = num(values.youth_participants);
  const adult = num(values.adult_participants);
  return youth === null && adult === null ? null : (youth ?? 0) + (adult ?? 0);
}

export interface MappingContext {
  formSlug: string;
  values: FormValues;
}

/**
 * Account fields taken from an application. Only filled where the Account's field is empty
 * (Salesforce stays the source of truth for policy data). Each entry returns a candidate value,
 * or a list of candidates for a picklist (first one the org has wins).
 */
export const ACCOUNT_FIELD_MAP: { field: string; value: (ctx: MappingContext) => unknown }[] = [
  { field: "Program__c", value: ({ formSlug }) => PROGRAM_BY_FORM[formSlug] ?? null },
  {
    field: "Legal_Entity__c",
    value: ({ formSlug, values }) => str(values.business_entity) || (INDIVIDUAL_FORMS.has(formSlug) ? "Individual" : null),
  },
  { field: "Number_of_Participants__c", value: ({ values }) => participants(values) },
  {
    field: "GL_Aggregate_Limit__c",
    value: ({ values }) => {
      const n = parseMoney(str(values.general_aggregate_limit));
      return Number.isFinite(n) && n > 0 ? n : null;
    },
  },
  { field: "Effective_Date__c", value: ({ values }) => str(values.requested_effective_date) || null },
  { field: "Contact_First_Name__c", value: ({ values }) => str(values.first_name) || null },
];

export interface Skipped {
  field: string;
  reason: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The org's own spelling of a picklist value, if it has it (active values only, ignoring case and punctuation). */
export function picklistMatch(field: FieldDescribe, candidate: string): string | null {
  const values = (field.picklistValues ?? []).filter((p) => p.active);
  const n = norm(candidate);
  return values.find((p) => norm(p.value) === n || norm(p.label) === n)?.value ?? null;
}

/**
 * Check candidate values against the object's describe and convert them to what Salesforce accepts.
 * Missing fields, read-only fields, unknown picklist values and wrong types are skipped with a reason.
 */
export function prepareFields(
  describe: ObjectDescribe,
  candidates: Record<string, unknown>,
  mode: "create" | "update" = "create",
): { data: Record<string, unknown>; skipped: Skipped[] } {
  const byName = new Map(describe.fields.map((f) => [f.name.toLowerCase(), f]));
  const data: Record<string, unknown> = {};
  const skipped: Skipped[] = [];
  for (const [name, raw] of Object.entries(candidates)) {
    if (raw === null || raw === undefined || raw === "") continue;
    const field = byName.get(name.toLowerCase());
    if (!field) {
      skipped.push({ field: name, reason: `missing field: ${describe.name}.${name}` });
      continue;
    }
    if ((mode === "create" && field.createable === false) || (mode === "update" && field.updateable === false)) {
      skipped.push({ field: name, reason: `${describe.name}.${name} isn't writable by the integration user` });
      continue;
    }
    const value = convert(field, raw);
    if (value.ok) data[field.name] = value.value;
    else skipped.push({ field: name, reason: value.reason });
  }
  return { data, skipped };
}

function convert(field: FieldDescribe, raw: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
  switch (field.type) {
    case "picklist": {
      for (const c of list) {
        const v = picklistMatch(field, c);
        if (v) return { ok: true, value: v };
      }
      return { ok: false, reason: `${field.name}: "${list.join('" / "')}" isn't one of its picklist values` };
    }
    case "multipicklist": {
      const vals = list.map((c) => picklistMatch(field, c)).filter((v): v is string => !!v);
      return vals.length ? { ok: true, value: vals.join(";") } : { ok: false, reason: `${field.name}: no matching picklist values` };
    }
    case "double":
    case "currency":
    case "percent":
    case "int":
    case "long": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
      return Number.isFinite(n) ? { ok: true, value: field.type === "int" || field.type === "long" ? Math.round(n) : n } : { ok: false, reason: `${field.name}: not a number` };
    }
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? { ok: true, value: String(raw) } : { ok: false, reason: `${field.name}: not a date (YYYY-MM-DD)` };
    case "boolean":
      return { ok: true, value: raw === true || raw === "true" || raw === "Yes" };
    case "url":
      return String(raw).length <= (field.length || 255) ? { ok: true, value: String(raw) } : { ok: false, reason: `${field.name}: link longer than ${field.length || 255} characters` };
    default: {
      const s = String(raw);
      return { ok: true, value: field.length ? s.slice(0, field.length) : s };
    }
  }
}

/** Account field candidates from an application (Program, Legal Entity, participants, limits, effective date). */
export function accountCandidates(ctx: MappingContext): Record<string, unknown> {
  return Object.fromEntries(ACCOUNT_FIELD_MAP.map((m) => [m.field, m.value(ctx)]).filter(([, v]) => v !== null && v !== undefined));
}

export interface OpportunityStage {
  label: string;
  isClosed: boolean;
  isWon: boolean;
  sortOrder: number;
}

/**
 * The Opportunity stage for an application's status: the stage set in Admin → Settings if the org
 * has it, otherwise the first open stage (submitted but not bound is never Closed Won), the first
 * won stage for "bound", and the first closed-lost stage for "declined" / "withdrawn".
 */
export function chooseStage(
  stages: OpportunityStage[],
  status: ApplicationStatus,
  configured: Partial<Record<ApplicationStatus, string>> = {},
): { stage: string | null; note?: string } {
  const sorted = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const wanted = configured[status];
  if (wanted) {
    const hit = sorted.find((s) => norm(s.label) === norm(wanted));
    if (hit) return { stage: hit.label };
  }
  const fallback =
    status === "bound"
      ? sorted.find((s) => s.isWon)
      : status === "declined" || status === "withdrawn"
        ? sorted.find((s) => s.isClosed && !s.isWon)
        : sorted.find((s) => !s.isClosed);
  return {
    stage: fallback?.label ?? null,
    note: wanted ? `Stage "${wanted}" (Settings, ${status}) isn't an active Opportunity stage; used "${fallback?.label ?? "none"}"` : undefined,
  };
}

/** "<Account Name> - <year>", the org's naming, using the requested effective date's year when there is one. */
export function opportunityName(accountName: string, values: FormValues, now = new Date()): string {
  const year = /^(\d{4})-\d{2}-\d{2}$/.exec(str(values.requested_effective_date))?.[1] ?? String(now.getFullYear());
  return `${accountName} - ${year}`.slice(0, 120);
}

/** Close Date: the requested effective date, else 30 days out. Required on every Opportunity. */
export function closeDate(values: FormValues, now = new Date()): string {
  const d = str(values.requested_effective_date);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
}
