import {
  type Field,
  type FormDefinition,
  type FormValues,
  type InputField,
  type Option,
  type Section,
  isInputField,
  tableCellId,
  tableRowCountId,
} from "./types";

export type FieldErrors = Record<string, string>;

export const isVisible = (field: Field, values: FormValues) =>
  !field.showIf || field.showIf(values);

export const visibleInputs = (section: Section, values: FormValues): InputField[] =>
  section.fields.filter(isInputField).filter((f) => isVisible(f, values));

const isEmpty = (v: FormValues[string]) =>
  v === undefined || (Array.isArray(v) ? v.length === 0 : v.trim() === "");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateField(field: InputField, values: FormValues): string | null {
  const value = values[field.id];
  if (isEmpty(value)) return field.required ? "This field is required." : null;
  if (Array.isArray(value)) {
    if (field.type === "checkboxes") {
      const allowed = new Set(field.options.map((o) => o.value));
      if (value.some((v) => !allowed.has(v))) return "Invalid selection.";
    }
    return null;
  }

  const v = value!.trim();
  switch (field.type) {
    case "email":
      return EMAIL_RE.test(v) ? null : "Enter a valid email address.";
    case "tel":
      return v.replace(/\D/g, "").length >= 10 ? null : "Enter a valid phone number.";
    case "url":
      return /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v) ? null : "Enter a valid website.";
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : "Enter a valid date.";
    case "number":
    case "currency": {
      const n = Number(v.replace(/[$,]/g, ""));
      if (Number.isNaN(n)) return "Enter a number.";
      if (field.min !== undefined && n < field.min) return `Must be at least ${field.min}.`;
      if (field.max !== undefined && n > field.max) return `Must be at most ${field.max}.`;
      return null;
    }
    case "select":
    case "radio": {
      const opts = field.filterOptions ? field.filterOptions(field.options, values) : field.options;
      return opts.some((o) => o.value === v) ? null : "Choose one of the options.";
    }
    case "signature":
      return v.startsWith("data:image/png;base64,") ? null : "Please sign the application.";
    default:
      return null;
  }
}

export function validateSection(section: Section, values: FormValues): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of visibleInputs(section, values)) {
    const err = validateField(field, values);
    if (err) errors[field.id] = err;
  }
  return errors;
}

export function validateForm(form: FormDefinition, values: FormValues): FieldErrors {
  return Object.assign({}, ...form.sections.map((s) => validateSection(s, values)));
}

/**
 * Remove anything the form doesn't define or that's currently hidden, so a
 * hidden branch the user filled in and then toggled off is never submitted.
 */
export function pruneValues(form: FormDefinition, values: FormValues): FormValues {
  const out: FormValues = {};
  for (const section of form.sections) {
    for (const field of section.fields) {
      if (!isVisible(field, values)) continue;
      if (field.type === "table") {
        const rows = clampRows(values[tableRowCountId(field.id)], field.maxRows);
        out[tableRowCountId(field.id)] = String(rows);
        for (let r = 1; r <= rows; r++) {
          for (const col of field.columns) {
            const id = tableCellId(field.id, r, col.id);
            if (typeof values[id] === "string") out[id] = values[id];
          }
        }
      } else if (isInputField(field) && values[field.id] !== undefined) {
        out[field.id] = values[field.id];
      }
    }
  }
  return out;
}

export const clampRows = (raw: FormValues[string], max: number) => {
  const n = Number(raw ?? 1);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : 1;
};

/** Swap in dropdown options pulled from GHL (see `syncOptionsFromGhl`). */
export function applyOptionOverrides(form: FormDefinition, overrides: Record<string, Option[]>): FormDefinition {
  if (!Object.keys(overrides).length) return form;
  return {
    ...form,
    sections: form.sections.map((s) => ({
      ...s,
      fields: s.fields.map((f) => (isInputField(f) && "options" in f && overrides[f.id] ? { ...f, options: overrides[f.id] } : f)),
    })),
  };
}
