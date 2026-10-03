import { clampRows } from "./validate";
import { type FormDefinition, type FormValues, isInputField, tableCellId, tableRowCountId } from "./types";

export interface AnswerRow {
  label: string;
  value: string;
  /** Nearest subheading, e.g. "Location #02" — disambiguates repeated labels. */
  group?: string;
}

export interface AnswerSection {
  title: string;
  rows: AnswerRow[];
}

const present = (v: FormValues[string]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
const show = (v: FormValues[string]) => (Array.isArray(v) ? v.join(", ") : (v ?? ""));

/** Answered questions only, in form order, grouped by section. Signature excluded. */
export function answerSections(form: FormDefinition, values: FormValues): AnswerSection[] {
  const out: AnswerSection[] = [];
  for (const section of form.sections) {
    const rows: AnswerRow[] = [];
    let group: string | undefined;
    for (const field of section.fields) {
      if (field.showIf && !field.showIf(values)) continue;
      if (field.type === "content") {
        if (field.variant === "subheading") group = field.title;
      } else if (field.type === "table") {
        const n = clampRows(values[tableRowCountId(field.id)], field.maxRows);
        for (let r = 1; r <= n; r++) {
          const cells = field.columns
            .map((c) => ({ label: c.label, value: values[tableCellId(field.id, r, c.id)] }))
            .filter((c) => present(c.value));
          if (cells.length) {
            rows.push({
              group: `${field.label} — entry ${r}`,
              label: cells[0].label,
              value: cells.map((c) => `${c.label}: ${show(c.value)}`).join(" · "),
            });
          }
        }
      } else if (isInputField(field) && field.type !== "signature" && present(values[field.id])) {
        rows.push({ group, label: field.label, value: show(values[field.id]) });
      }
    }
    if (rows.length) out.push({ title: section.title, rows });
  }
  return out;
}

/**
 * Flat text for full-text search. A "Yes" contributes the question itself, so
 * searching "trampoline" finds applicants who answered Yes to "Do you have
 * trampolines?"; "No" answers are left out so they don't match.
 */
export function searchText(form: FormDefinition, values: FormValues, extra: string[] = []): string {
  const parts = [...extra, form.title];
  for (const s of answerSections(form, values)) {
    for (const r of s.rows) {
      if (r.value === "No") continue;
      parts.push(r.value === "Yes" ? r.label : r.value);
    }
  }
  return parts.join(" \n ").slice(0, 100_000);
}

/** Plain text of the whole application (used for the AI summary and exports). */
export function answersAsText(form: FormDefinition, values: FormValues): string {
  return answerSections(form, values)
    .map((s) => [`## ${s.title}`, ...s.rows.map((r) => `- ${r.group ? `[${r.group}] ` : ""}${r.label}: ${r.value}`)].join("\n"))
    .join("\n\n");
}
