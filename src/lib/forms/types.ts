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
}

export interface TextField extends BaseField {
  type: "text" | "email" | "tel" | "url" | "date" | "textarea";
}

export interface NumberField extends BaseField {
  type: "number" | "currency";
  min?: number;
  max?: number;
}

export interface ChoiceField extends BaseField {
  type: "select" | "radio" | "checkboxes";
  options: Option[];
  /** Narrow the options based on other answers (e.g. only show existing locations). */
  filterOptions?: (options: Option[], values: FormValues) => Option[];
}

export interface SignatureField extends BaseField {
  type: "signature";
}

/** Static content block (headings, notices, instructions). Not an input. */
export interface ContentBlock {
  type: "content";
  id: string;
  title?: string;
  body?: string | string[];
  variant?: "info" | "notice" | "subheading";
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

export type InputField = TextField | NumberField | ChoiceField | SignatureField;
export type Field = InputField | ContentBlock | TableField;

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
}

export const isInputField = (f: Field): f is InputField =>
  f.type !== "content" && f.type !== "table";

export const tableCellId = (tableId: string, row: number, colId: string) =>
  `${tableId}__${row}__${colId}`;
export const tableRowCountId = (tableId: string) => `${tableId}__rows`;
