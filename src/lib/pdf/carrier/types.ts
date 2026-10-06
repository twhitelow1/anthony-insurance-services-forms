import type { FormValues } from "@/lib/forms/types";
import { parseMoney } from "@/lib/forms/helpers";

/** Where a value goes on the carrier's fillable PDF. */
export interface CarrierFill {
  /** AcroForm text field name → value. */
  text: Map<string, { value: string; label: string }>;
  /** AcroForm checkbox names to tick. */
  checked: Set<string>;
  /** Printed on the addendum page ("Attach additional pages if needed"). */
  addendum: { label: string; value: string }[];
}

/** A carrier's fillable application and how a web form's answers map onto it. */
export interface CarrierFormSpec {
  formSlug: string;
  /** Shown to staff, e.g. "Carrier application (SFIC-STL-APP-001)". */
  name: string;
  /** Path from the project root. Listed in next.config.ts outputFileTracingIncludes. */
  template: string;
  /** Signature image box and date position, in PDF points from the bottom-left of the page (0-based page). */
  signature: { page: number; x: number; y: number; width: number; height: number };
  date: { page: number; x: number; y: number };
  map(values: FormValues, fill: Filler): void;
}

const str = (v: FormValues[string]) => (typeof v === "string" ? v.trim() : "");

/** Small DSL the per-carrier mappings use. */
export class Filler implements CarrierFill {
  text = new Map<string, { value: string; label: string }>();
  checked = new Set<string>();
  addendum: { label: string; value: string }[] = [];

  constructor(private readonly values: FormValues) {}

  get(id: string): string {
    return str(this.values[id]);
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
