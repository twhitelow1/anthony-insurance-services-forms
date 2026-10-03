"use client";

import type { ReactNode } from "react";
import { clampRows } from "@/lib/forms/validate";
import {
  type ContentBlock,
  type FormValue,
  type FormValues,
  type InputField,
  type Option,
  type TableField,
  tableCellId,
  tableRowCountId,
} from "@/lib/forms/types";
import { SignaturePad } from "./SignaturePad";
import { Tooltip } from "./Tooltip";

const WIDTH = { full: "sm:col-span-6", half: "sm:col-span-3", third: "sm:col-span-2" } as const;

function Shell({
  field,
  error,
  children,
  asFieldset,
}: {
  field: InputField;
  error?: string;
  children: ReactNode;
  asFieldset?: boolean;
}) {
  const labelContent = (
    <>
      <span>{field.label}</span>
      {field.required && (
        <span className="text-[var(--danger)]" aria-hidden="true">
          {" "}*
        </span>
      )}
    </>
  );
  const hintId = field.hint ? `${field.id}-hint` : undefined;
  const errId = error ? `${field.id}-error` : undefined;
  const Wrapper = asFieldset ? "fieldset" : "div";

  return (
    <Wrapper className={`col-span-6 ${WIDTH[field.width ?? "full"]} min-w-0`} aria-describedby={asFieldset ? errId : undefined}>
      {asFieldset ? (
        // <legend> must be the fieldset's first child for screen readers to announce the group name.
        <legend className="field-label mb-1.5">
          {labelContent}
          {field.tooltip && (
            <span className="ml-1.5">
              <Tooltip content={field.tooltip} label={`About: ${field.label}`} />
            </span>
          )}
        </legend>
      ) : (
        <div className="mb-1.5 flex items-start gap-1.5">
          <label htmlFor={field.id} className="field-label">
            {labelContent}
          </label>
          {field.tooltip && <Tooltip content={field.tooltip} label={`About: ${field.label}`} />}
        </div>
      )}
      {children}
      {field.hint && (
        <p id={hintId} className="mt-1 text-sm text-[var(--muted)]">
          {field.hint}
        </p>
      )}
      {error && (
        <p id={errId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </Wrapper>
  );
}

const formatPhone = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

const formatMoney = (raw: string) => {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [int, dec] = cleaned.split(".");
  const withCommas = (int ?? "").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec !== undefined ? `${withCommas}.${dec.slice(0, 2)}` : withCommas;
};

export function FieldInput({
  field,
  value,
  error,
  options,
  onChange,
}: {
  field: InputField;
  value: FormValue;
  error?: string;
  /** Effective options (after GHL sync + filtering) for choice fields. */
  options?: Option[];
  onChange: (v: FormValue) => void;
}) {
  const describedBy = [field.hint && `${field.id}-hint`, error && `${field.id}-error`].filter(Boolean).join(" ") || undefined;
  const common = {
    id: field.id,
    name: field.id,
    "aria-invalid": !!error,
    "aria-describedby": describedBy,
    "aria-required": field.required,
    className: `input ${error ? "is-invalid" : ""}`,
  };
  const str = typeof value === "string" ? value : "";

  switch (field.type) {
    case "textarea":
      return (
        <Shell field={field} error={error}>
          <textarea {...common} rows={4} value={str} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
        </Shell>
      );
    case "tel":
      return (
        <Shell field={field} error={error}>
          <input
            {...common}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={str}
            placeholder="(555) 555-5555"
            onChange={(e) => onChange(formatPhone(e.target.value))}
          />
        </Shell>
      );
    case "currency":
      return (
        <Shell field={field} error={error}>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--muted)]">$</span>
            <input
              {...common}
              className={`${common.className} pl-7`}
              type="text"
              inputMode="decimal"
              value={str}
              placeholder="0"
              onChange={(e) => onChange(formatMoney(e.target.value))}
            />
          </div>
        </Shell>
      );
    case "number":
      return (
        <Shell field={field} error={error}>
          <input
            {...common}
            type="number"
            inputMode="numeric"
            min={field.min}
            max={field.max}
            value={str}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            onWheel={(e) => (e.target as HTMLInputElement).blur()}
          />
        </Shell>
      );
    case "select":
      return (
        <Shell field={field} error={error}>
          <select {...common} value={str} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">Select an option</option>
            {(options ?? field.options).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Shell>
      );
    case "radio": {
      const list = options ?? field.options;
      return (
        <Shell field={field} error={error} asFieldset>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-describedby={describedBy}>
            {list.map((o) => (
              <label key={o.value} className={`choice ${str === o.value ? "is-checked" : ""} ${error ? "is-invalid" : ""}`}>
                <input
                  type="radio"
                  name={field.id}
                  value={o.value}
                  checked={str === o.value}
                  onChange={() => onChange(o.value)}
                  className="sr-only"
                />
                <span className="choice-dot" aria-hidden="true" />
                {o.label}
              </label>
            ))}
          </div>
        </Shell>
      );
    }
    case "checkboxes": {
      const arr = Array.isArray(value) ? value : [];
      return (
        <Shell field={field} error={error} asFieldset>
          <div className="flex flex-wrap gap-2" aria-describedby={describedBy}>
            {(options ?? field.options).map((o) => {
              const checked = arr.includes(o.value);
              return (
                <label key={o.value} className={`choice ${checked ? "is-checked" : ""} ${error ? "is-invalid" : ""}`}>
                  <input
                    type="checkbox"
                    name={field.id}
                    value={o.value}
                    checked={checked}
                    onChange={() => onChange(checked ? arr.filter((x) => x !== o.value) : [...arr, o.value])}
                    className="sr-only"
                  />
                  <span className="choice-box" aria-hidden="true" />
                  {o.label}
                </label>
              );
            })}
          </div>
        </Shell>
      );
    }
    case "signature":
      return (
        <Shell field={field} error={error}>
          <SignaturePad id={field.id} value={str || undefined} invalid={!!error} onChange={onChange} />
        </Shell>
      );
    default:
      return (
        <Shell field={field} error={error}>
          <input
            {...common}
            type={field.type}
            value={str}
            placeholder={field.placeholder}
            autoComplete={AUTOCOMPLETE[field.id]}
            onChange={(e) => onChange(e.target.value)}
          />
        </Shell>
      );
  }
}

const AUTOCOMPLETE: Record<string, string> = {
  first_name: "given-name",
  last_name: "family-name",
  email: "email",
  website: "url",
  mailing_address: "address-line1",
  mailing_city: "address-level2",
  mailing_postal_code: "postal-code",
  legal_business_name: "organization",
};

export function Content({ block }: { block: ContentBlock }) {
  const body = Array.isArray(block.body) ? block.body : block.body ? [block.body] : [];
  if (block.variant === "subheading") {
    return (
      <div className="col-span-6 mt-4 border-b border-[var(--border)] pb-2 first:mt-0">
        <h3 className="text-base font-semibold text-[var(--brand)]">{block.title}</h3>
        {body.map((b) => (
          <p key={b} className="text-sm text-[var(--muted)]">
            {b}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className={`col-span-6 callout ${block.variant === "notice" ? "callout-notice" : ""}`}>
      {block.title && <p className="mb-2 font-semibold">{block.title}</p>}
      {body.length > 1 ? (
        <ol className="list-decimal space-y-1 pl-5">
          {body.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ol>
      ) : (
        body.map((b) => <p key={b}>{b}</p>)
      )}
    </div>
  );
}

export function TableInput({
  table,
  values,
  setValues,
}: {
  table: TableField;
  values: FormValues;
  setValues: (patch: FormValues) => void;
}) {
  const rows = clampRows(values[tableRowCountId(table.id)], table.maxRows);
  const cell = (r: number, c: string) => values[tableCellId(table.id, r, c)];

  const removeRow = (row: number) => {
    // Shift later rows up so stored values stay contiguous (row 1..n).
    const patch: FormValues = { [tableRowCountId(table.id)]: String(Math.max(rows - 1, 1)) };
    for (let r = row; r <= rows; r++) {
      for (const col of table.columns) {
        patch[tableCellId(table.id, r, col.id)] = r < rows ? cell(r + 1, col.id) : undefined;
      }
    }
    setValues(patch);
  };

  return (
    <div className="col-span-6">
      <h3 className="field-label">{table.label}</h3>
      {table.description && <p className="mb-3 text-sm text-[var(--muted)]">{table.description}</p>}
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => i + 1).map((r) => (
          <div key={r} className="table-row-card">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--brand)]">Entry {r}</span>
              {rows > 1 && (
                <button type="button" className="btn-link text-[var(--danger)]" onClick={() => removeRow(r)}>
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              {table.columns.map((col, ci) => {
                const id = tableCellId(table.id, r, col.id);
                return (
                  <div key={col.id} className={ci === 0 ? "col-span-2 sm:col-span-6" : "col-span-1"}>
                    <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--muted)]">
                      {col.label}
                    </label>
                    <input
                      id={id}
                      className="input"
                      type={col.type === "number" ? "number" : "text"}
                      inputMode={col.type === "number" ? "numeric" : undefined}
                      min={col.type === "number" ? 0 : undefined}
                      value={(cell(r, col.id) as string) ?? ""}
                      placeholder={col.type === "number" ? "0" : "e.g. Gymnastics"}
                      onChange={(e) => setValues({ [id]: e.target.value })}
                      onWheel={(e) => (e.target as HTMLInputElement).blur()}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {rows < table.maxRows ? (
        <button
          type="button"
          className="btn-secondary mt-3"
          onClick={() => setValues({ [tableRowCountId(table.id)]: String(rows + 1) })}
        >
          + Add entry
        </button>
      ) : (
        <p className="mt-3 text-sm text-[var(--muted)]">Maximum of {table.maxRows} entries reached.</p>
      )}
    </div>
  );
}
