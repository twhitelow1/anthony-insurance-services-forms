/**
 * Schema-driven form definitions.
 *
 * Every form is plain data (sections -> fields). The same definition drives:
 *  - the client-side wizard UI (rendering, conditional visibility, tooltips)
 *  - server-side validation (the API never trusts the browser)
 *  - the staff/client views of a stored application
 *  - which answers are copied onto the Lead Alchemist contact
 */

export type FormValue = string | string[] | undefined;
export type FormValues = Record<string, FormValue>;

/** Standard (non-custom) Lead Alchemist contact fields we can write to directly. */
export type GhlStandardField =
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "website"
  | "address1"
  | "city"
  | "state"
  | "postalCode"
  | "companyName";

/** Copy this answer onto a built-in Lead Alchemist contact field. */
export type GhlMapping = { standard: GhlStandardField };

export interface Option {
  label: string;
  value: string;
}

type Predicate = (values: FormValues) => boolean;

interface BaseField {
  id: string;
  label: string;
  /** Rendered as an interactive info tooltip next to the label. */
  tooltip?: string;
  /** Small helper text rendered under the input. */
  hint?: string;
  placeholder?: string;
  required?: boolean;
  /** Field is only shown (and only validated/submitted) when this returns true. */
  showIf?: Predicate;
  /** Layout width on desktop. Defaults to "full". */
  width?: "full" | "half" | "third";
  ghl?: GhlMapping;
  /**
   * Read-only answer worked out from other answers (e.g. a total). The applicant
   * sees it but can't type in it; it's recalculated on the server before saving.
   */
  compute?: (values: FormValues) => string | undefined;
}

/** A popup shown when the applicant picks `when`. */
export interface AnswerAlert {
  when: string;
  title: string;
  message: string;
}

export interface TextField extends BaseField {
  type: "text" | "email" | "tel" | "url" | "date" | "textarea";
}

export interface NumberField extends BaseField {
  type: "number" | "currency";
  min?: number;
  max?: number;
  /** Shown instead of "Must be at most …" when the answer is over `max`. */
  maxMessage?: string;
}

export interface ChoiceField extends BaseField {
  type: "select" | "radio" | "checkboxes";
  options: Option[];
  /** Narrow the options based on other answers (e.g. only show existing locations). */
  filterOptions?: (options: Option[], values: FormValues) => Option[];
  /**
   * Auto-decline: this answer means we can't offer coverage. It shows a red popup
   * and blocks continuing and submitting (checked on the server too).
   */
  decline?: AnswerAlert;
  /**
   * Compliance notice: this answer is allowed, but shows a popup (e.g. "must be in
   * place before coverage starts"). `documents` are sample files from
   * compliance-docs/ attached to the applicant's confirmation email.
   */
  notice?: AnswerAlert & { documents?: string[] };
}

export interface SignatureField extends BaseField {
  type: "signature";
}

/**
 * File upload (e.g. waivers). Files go to the server as they're picked; the answer is a
 * list of upload references, "<upload id>|<file name>", attached to the application on submit.
 */
export interface FileField extends BaseField {
  type: "file";
  /** Most files the applicant can attach. Defaults to 5. */
  maxFiles?: number;
  /**
   * Shown in a popup when the applicant goes on without uploading (they can still go on),
   * and repeated in their confirmation email.
   */
  missingNotice?: { title: string; message: string };
}

/** "<upload id>|<file name>" → its parts. */
export function parseUploadRef(ref: string): { id: string; filename: string } | null {
  const m = ref.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|(.{1,200})$/);
  return m ? { id: m[1], filename: m[2] } : null;
}

/** Static content block (headings, notices, instructions). Not an input. */
export interface ContentBlock {
  type: "content";
  id: string;
  title?: string;
  body?: string | string[];
  variant?: "info" | "notice" | "subheading";
  /** Several body items show as a numbered list unless this is "paragraphs". */
  bodyStyle?: "list" | "paragraphs";
  /** A numbered entry's heading (from a repeat control) gets a Remove button for entries after the first. */
  removes?: { repeat: string; prefix: string; entry: number };
  showIf?: Predicate;
}

/**
 * "+ Add another …" for numbered entries (e.g. Additional Insured #1, #2, …). Only entry 1 shows at
 * first; each click shows the next. Entry n's fields have ids starting `${prefix}${n}_` and are shown
 * while the count (stored under `id`) is at least n.
 */
export interface RepeatControl {
  type: "repeat";
  id: string;
  addLabel: string;
  prefix: string;
  max: number;
  showIf?: Predicate;
}

/** A repeatable table (e.g. "Sport / Activity" rows). Each cell is stored as `${id}__${row}__${column.id}`. */
export interface TableField {
  type: "table";
  id: string;
  label: string;
  description?: string;
  maxRows: number;
  columns: {
    id: string;
    label: string;
    type: "text" | "number";
  }[];
  showIf?: Predicate;
}

export type InputField = TextField | NumberField | ChoiceField | SignatureField | FileField;
export type Field = InputField | ContentBlock | TableField | RepeatControl;

export interface Section {
  id: string;
  title: string;
  description?: string;
  fields: Field[];
}

export interface FormDefinition {
  slug: string;
  title: string;
  subtitle?: string;
  /** Tags applied to the Lead Alchemist contact on submit — use these to trigger workflows. */
  tags: string[];
  /** Value for the Lead Alchemist contact `source` field. */
  source: string;
  sections: Section[];
  successMessage: string;
  /**
   * Which agency site the form belongs to ("ais" | "dsi" | "masi"): its embed and
   * emails use that brand. Unset → worked out from the tags (see defaultBrand).
   */
  brand?: "ais" | "dsi" | "masi";
}

export const isInputField = (f: Field): f is InputField =>
  f.type !== "content" && f.type !== "table" && f.type !== "repeat";

/** How many entries a repeat control shows (at least 1, at most its max). */
export const repeatCount = (values: FormValues, id: string, max: number) => {
  const n = Number(values[id]);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : 1;
};

/** Values after removing entry `entry`: later entries move up one, and the count drops by one. */
export function removeRepeatEntry(values: FormValues, control: { id: string; prefix: string; max: number }, entry: number): FormValues {
  const count = repeatCount(values, control.id, control.max);
  const patch: FormValues = { [control.id]: String(Math.max(count - 1, 1)) };
  const re = new RegExp(`^${control.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)_(.+)$`);
  const byEntry = new Map<number, Map<string, FormValues[string]>>();
  for (const [k, v] of Object.entries(values)) {
    const m = k.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (!byEntry.has(n)) byEntry.set(n, new Map());
    byEntry.get(n)!.set(m[2], v);
  }
  for (let n = entry; n <= count; n++) {
    const keys = new Set([...(byEntry.get(n)?.keys() ?? []), ...(byEntry.get(n + 1)?.keys() ?? [])]);
    for (const key of keys) patch[`${control.prefix}${n}_${key}`] = n < count ? byEntry.get(n + 1)?.get(key) : undefined;
  }
  return patch;
}

export const tableCellId = (tableId: string, row: number, colId: string) =>
  `${tableId}__${row}__${colId}`;
export const tableRowCountId = (tableId: string) => `${tableId}__rows`;
