/**
 * Schema-driven form definitions.
 *
 * Every form is plain data (sections -> fields). The same definition drives:
 *  - the client-side wizard UI (rendering, conditional visibility, tooltips)
 *  - server-side validation (the API never trusts the browser)
 *  - the mapping of answers onto GoHighLevel contact + custom fields
 */

export type FormValue = string | string[] | undefined;
export type FormValues = Record<string, FormValue>;

/** Standard (non-custom) GHL contact fields we can write to directly. */
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

/**
 * How a field maps to GoHighLevel.
 *  - `standard`: write to a built-in contact field
 *  - `key`: exact custom field key, e.g. "contact.legal_business_name"
 *  - `name`: custom field display name to match (defaults to the field label)
 *  - `false`: don't send this field to GHL
 */
export type GhlMapping =
  | false
  | {
      standard?: GhlStandardField;
      key?: string;
      name?: string;
    };

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
  /**
   * When true, the option list may be replaced with the picklist options defined
   * on the matching GHL custom field, so the form always matches GHL exactly.
   */
  syncOptionsFromGhl?: boolean;
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

/**
 * A repeatable table (e.g. "Sport / Activity" rows). Each cell is stored as a
 * flat value `${id}__${row}__${column.id}` so it maps onto the flat GHL custom
 * fields ("Sport / Activity 1 | 12 & Under", ...).
 */
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
    /** GHL custom field name for row `n` (1-based). */
    ghlName: (row: number) => string;
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
  /** Tags applied to the GHL contact on submit — use these to trigger workflows. */
  tags: string[];
  /** Value for the GHL contact `source` field. */
  source: string;
  sections: Section[];
  successMessage: string;
}

export const isInputField = (f: Field): f is InputField =>
  f.type !== "content" && f.type !== "table";

export const tableCellId = (tableId: string, row: number, colId: string) =>
  `${tableId}__${row}__${colId}`;
export const tableRowCountId = (tableId: string) => `${tableId}__rows`;
