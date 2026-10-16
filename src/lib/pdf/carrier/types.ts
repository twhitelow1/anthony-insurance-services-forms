import type { FormValues } from "@/lib/forms/types";
import { parseMoney } from "@/lib/forms/helpers";

/** Where a value goes on the carrier's fillable PDF. */
export interface CarrierFill {
  /** AcroForm text field name → value. */
  text: Map<string, { value: string; label: string }>;
  /** AcroForm checkbox names to tick. */
  checked: Set<string>;
  /** AcroForm radio group name → the export value of the button to select. */
  radios: Map<string, string>;
  /** AcroForm dropdown name → the option to select, as the dropdown shows it. */
  dropdowns: Map<string, { value: string; label: string }>;
  /** Printed on the addendum page ("Attach additional pages if needed"). */
  addendum: { label: string; value: string }[];
}

/** A carrier's fillable application and how a web form's answers map onto it. */
export interface CarrierFormSpec {
  /** Web forms whose answers fill this PDF (they share field ids). */
  formSlugs: string[];
  /** Shown to staff, e.g. "Carrier application (SFIC-STL-APP-001)". */
  name: string;
  /** File name in carrier-forms/. That folder is listed in next.config.ts outputFileTracingIncludes. */
  template: string;
  /** Signature image box and date position, in PDF points from the bottom-left of the page (0-based page). */
  signature: { page: number; x: number; y: number; width: number; height: number };
  /** The template's own (empty) signature field over that box, made see-through so the signature shows. */
  signatureField?: string;
  /** Where the submission date is drawn. Omit when the mapping fills the template's own date field. */
  date?: { page: number; x: number; y: number };
  /**
   * Questions the applicant never saw (hidden by an earlier answer, e.g. the
   * trampoline follow-ups after "No trampolines") would otherwise print blank.
   * After mapping, each Yes/No pair with neither box ticked gets "No" and each
   * empty text box gets "N/A", except the fields listed here. Omit when the
   * mapping fills those defaults itself (e.g. a template whose premium and card
   * boxes must stay empty).
   */
  blanks?: { yesNoPair: RegExp; keepBlank: RegExp[] };
  /** `formSlug` is the web form answered, for the few differences between forms that share this PDF. */
  map(values: FormValues, fill: Filler, formSlug: string): void;
}

const str = (v: FormValues[string]) => (typeof v === "string" ? v.trim() : "");

/** Small DSL the per-carrier mappings use. */
export class Filler implements CarrierFill {
  text = new Map<string, { value: string; label: string }>();
  checked = new Set<string>();
  radios = new Map<string, string>();
  dropdowns = new Map<string, { value: string; label: string }>();
  addendum: { label: string; value: string }[] = [];

  constructor(private readonly values: FormValues) {}

  get(id: string): string {
    return str(this.values[id]);
  }

  /** A multiple-choice answer (checkboxes). */
  list(id: string): string[] {
    const v = this.values[id];
    return Array.isArray(v) ? v : [];
  }

  /** Text field. Empty values are skipped. */
  set(field: string, value: string | undefined, label: string) {
    const v = (value ?? "").trim();
    if (v) this.text.set(field, { value: v, label });
  }

  /** Text field from an answer, or `fallback` (e.g. "0", "N/A") when unanswered. */
  answer(field: string, id: string, label: string, fallback?: string) {
    this.set(field, this.get(id) || fallback, label);
  }

  check(field: string | undefined) {
    if (field) this.checked.add(field);
  }

  /** Select the radio button whose export value is `value` (e.g. "Choice1"). */
  radio(group: string, value: string | undefined) {
    if (value) this.radios.set(group, value);
  }

  /** A Yes/No answer as a radio group: `yes` / `no` are the buttons' export values. */
  yesNoRadio(id: string, group: string, yes: string, no: string) {
    const v = this.get(id);
    this.radio(group, v === "Yes" ? yes : v === "No" ? no : undefined);
  }

  /** Dropdown option, as the dropdown shows it. Empty values are skipped. */
  dropdown(field: string, value: string | undefined, label: string) {
    const v = (value ?? "").trim();
    if (v) this.dropdowns.set(field, { value: v, label });
  }

  yesNo(id: string, yes: string, no: string) {
    const v = this.get(id);
    if (v === "Yes") this.check(yes);
    else if (v === "No") this.check(no);
  }

  /**
   * Tick the checkbox whose option label matches the answer exactly. An answer with
   * no matching box goes on the addendum, so nothing the applicant said is lost.
   */
  option(id: string, label: string, choices: Record<string, string>) {
    const v = this.values[id];
    for (const o of Array.isArray(v) ? v : [str(v)].filter(Boolean)) {
      if (choices[o]) this.check(choices[o]);
      else this.note(label, o);
    }
  }

  /** Tick the box whose dollar amount matches, so "$1,000,000", "$1M" and "1000000" all work. */
  amount(id: string, label: string, choices: [number, string][], na?: string) {
    const v = this.get(id);
    if (!v) return;
    if (/^n\/?a$|^none$/i.test(v)) return na ? this.check(na) : undefined;
    const n = parseMoney(v);
    const hit = choices.find(([amt]) => amt === n)?.[1];
    if (hit) this.check(hit);
    else this.note(label, v);
  }

  /** Same as amount() for split limits like "$1,000,000 / $2,000,000". A single amount means both. */
  pair(id: string, label: string, choices: [number, number, string][], na?: string) {
    const v = this.get(id);
    if (!v) return;
    if (/^n\/?a$|^none$/i.test(v)) return na ? this.check(na) : undefined;
    const [a, b = a] = v.split("/").map(parseMoney);
    const hit = choices.find(([x, y]) => x === a && y === b)?.[2];
    if (hit) this.check(hit);
    else this.note(label, v);
  }

  note(label: string, value: string | undefined) {
    const v = (value ?? "").trim();
    if (v) this.addendum.push({ label, value: v });
  }
}
