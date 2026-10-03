import type { GhlCustomField, UpsertContactInput } from "./client";
import { clampRows } from "@/lib/forms/validate";
import {
  type FormDefinition,
  type FormValues,
  type GhlStandardField,
  type Option,
  isInputField,
  tableCellId,
  tableRowCountId,
} from "@/lib/forms/types";

/** "Street Address - Location #01" -> "streetaddresslocation01" */
export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

interface Target {
  valueId: string;
  label: string;
  standard?: GhlStandardField;
  custom?: { key?: string; name: string };
  isSignature?: boolean;
}

/** Every place a form value can land in GHL. */
export function formTargets(form: FormDefinition): Target[] {
  const targets: Target[] = [];
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (field.type === "table") {
        for (let r = 1; r <= field.maxRows; r++) {
          for (const col of field.columns) {
            targets.push({
              valueId: tableCellId(field.id, r, col.id),
              label: col.ghlName(r),
              custom: { name: col.ghlName(r) },
            });
          }
        }
        continue;
      }
      if (!isInputField(field) || field.ghl === false) continue;
      const g = field.ghl ?? {};
      const wantsCustom = !g.standard || g.key || g.name;
      targets.push({
        valueId: field.id,
        label: field.label,
        standard: g.standard,
        custom: wantsCustom ? { key: g.key, name: g.name ?? field.label } : undefined,
        isSignature: field.type === "signature",
      });
    }
  }
  return targets;
}

export type MatchResult = { field: GhlCustomField } | { ambiguous: GhlCustomField[] } | null;

export function matchCustomField(spec: { key?: string; name: string }, fields: GhlCustomField[]): MatchResult {
  if (spec.key) {
    const want = spec.key.replace(/^contact\./, "");
    const hit = fields.find((f) => f.fieldKey.replace(/^contact\./, "") === want);
    if (hit) return { field: hit };
  }
  const n = normalize(spec.name);
  const hits = fields.filter((f) => normalize(f.name) === n);
  if (hits.length === 1) return { field: hits[0] };
  if (hits.length > 1) return { ambiguous: hits };
  return null;
}

const ARRAY_TYPES = new Set(["CHECKBOX", "MULTIPLE_OPTIONS"]);
const NUMBER_TYPES = new Set(["NUMERICAL", "MONETORY", "MONETARY"]);

/** Coerce a form value into the shape the GHL field type expects. */
function coerce(value: string | string[], dataType: string): string | string[] | number {
  if (ARRAY_TYPES.has(dataType)) return Array.isArray(value) ? value : [value];
  const flat = Array.isArray(value) ? value.join(", ") : value.trim();
  if (NUMBER_TYPES.has(dataType)) {
    const n = Number(flat.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : flat;
  }
  return flat;
}

export interface BuiltPayload {
  contact: UpsertContactInput;
  signature?: { fieldId: string; dataUrl: string };
  /** Answers that had nowhere to go in GHL — included in the contact note so nothing is lost. */
  unmapped: { label: string; value: string }[];
}

export function buildContactPayload(
  form: FormDefinition,
  values: FormValues,
  customFields: GhlCustomField[],
): BuiltPayload {
  const contact: UpsertContactInput = { tags: form.tags, source: form.source, customFields: [] };
  const unmapped: BuiltPayload["unmapped"] = [];
  let signature: BuiltPayload["signature"];

  for (const t of formTargets(form)) {
    const raw = values[t.valueId];
    if (raw === undefined || (Array.isArray(raw) ? raw.length === 0 : raw.trim() === "")) continue;

    if (t.standard) contact[t.standard] = Array.isArray(raw) ? raw.join(", ") : raw.trim();
    if (!t.custom) continue;

    const match = matchCustomField(t.custom, customFields);
    if (!match || "ambiguous" in match) {
      if (!t.isSignature && !t.standard) unmapped.push({ label: t.label, value: Array.isArray(raw) ? raw.join(", ") : raw });
      continue;
    }
    if (t.isSignature) {
      if (typeof raw === "string") signature = { fieldId: match.field.id, dataUrl: raw };
      continue;
    }
    contact.customFields!.push({ id: match.field.id, field_value: coerce(raw, match.field.dataType) });
  }
  return { contact, signature, unmapped };
}

/** Dropdown options pulled from GHL so the form always matches the CRM exactly. */
export function ghlOptionOverrides(form: FormDefinition, customFields: GhlCustomField[]): Record<string, Option[]> {
  const out: Record<string, Option[]> = {};
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!isInputField(field) || field.ghl === false) continue;
      if (!("syncOptionsFromGhl" in field) || !field.syncOptionsFromGhl) continue;
      const match = matchCustomField({ key: field.ghl?.key, name: field.ghl?.name ?? field.label }, customFields);
      const picklist = match && "field" in match ? match.field.picklistOptions : undefined;
      if (picklist?.length) out[field.id] = picklist.map((p) => ({ label: p, value: p }));
    }
  }
  return out;
}

/** Human-readable audit of how every form field resolves against the live GHL fields. */
export function mappingReport(form: FormDefinition, customFields: GhlCustomField[]) {
  const used = new Set<string>();
  const rows = formTargets(form).map((t) => {
    const match = t.custom ? matchCustomField(t.custom, customFields) : null;
    if (match && "field" in match) used.add(match.field.id);
    return {
      formField: t.valueId,
      label: t.label,
      standard: t.standard ?? null,
      lookingFor: t.custom ? (t.custom.key ?? t.custom.name) : null,
      status: !t.custom
        ? "standard"
        : !match
          ? "MISSING"
          : "ambiguous" in match
            ? "AMBIGUOUS"
            : "ok",
      ghl:
        match && "field" in match
          ? { id: match.field.id, key: match.field.fieldKey, name: match.field.name, type: match.field.dataType }
          : match && "ambiguous" in match
            ? match.ambiguous.map((f) => ({ id: f.id, key: f.fieldKey, name: f.name }))
            : null,
    };
  });
  return {
    form: form.slug,
    summary: {
      total: rows.length,
      ok: rows.filter((r) => r.status === "ok").length,
      standardOnly: rows.filter((r) => r.status === "standard").length,
      missing: rows.filter((r) => r.status === "MISSING").length,
      ambiguous: rows.filter((r) => r.status === "AMBIGUOUS").length,
    },
    problems: rows.filter((r) => r.status === "MISSING" || r.status === "AMBIGUOUS"),
    rows,
    unusedGhlFields: customFields
      .filter((f) => !used.has(f.id))
      .map((f) => ({ id: f.id, key: f.fieldKey, name: f.name, type: f.dataType })),
  };
}

/** Plain-text summary of the full submission for a GHL contact note (audit trail). */
export function submissionNote(form: FormDefinition, values: FormValues, meta: Record<string, string>): string {
  const lines: string[] = [`📋 ${form.title}`, ...Object.entries(meta).map(([k, v]) => `${k}: ${v}`), ""];
  for (const section of form.sections) {
    const sectionLines: string[] = [];
    let pendingHeading: string | undefined;
    const push = (line: string) => {
      // Only print a subheading (e.g. "Location #02") if something under it was answered.
      if (pendingHeading) sectionLines.push(`[${pendingHeading}]`);
      pendingHeading = undefined;
      sectionLines.push(line);
    };
    for (const field of section.fields) {
      if (field.type === "content") {
        if (field.variant === "subheading" && (!field.showIf || field.showIf(values))) pendingHeading = field.title;
      } else if (field.type === "table") {
        const rows = clampRows(values[tableRowCountId(field.id)], field.maxRows);
        for (let r = 1; r <= rows; r++) {
          const cells = field.columns
            .map((c) => [c.label, values[tableCellId(field.id, r, c.id)]] as const)
            .filter(([, v]) => v);
          if (cells.length) push(`${field.label} #${r}: ${cells.map(([l, v]) => `${l}: ${v}`).join(" | ")}`);
        }
      } else if (isInputField(field) && field.type !== "signature") {
        const v = values[field.id];
        if (v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) {
          push(`${field.label}: ${Array.isArray(v) ? v.join(", ") : v}`);
        }
      }
    }
    if (sectionLines.length) lines.push(`— ${section.title.toUpperCase()} —`, ...sectionLines, "");
  }
  return lines.join("\n");
}
