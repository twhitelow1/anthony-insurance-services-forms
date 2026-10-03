import type { ChoiceField, FormValues, NumberField, Option, TextField } from "./types";

export const opts = (...labels: string[]): Option[] =>
  labels.map((label) => ({ label, value: label }));

export const YES_NO = opts("Yes", "No");

/** Yes/No radio — required by default ("All questions must be answered"). */
export const yesNo = (
  id: string,
  label: string,
  extra: Partial<Omit<ChoiceField, "type" | "id" | "label" | "options">> = {},
): ChoiceField => ({ type: "radio", id, label, options: YES_NO, required: true, ...extra });

export const text = (
  id: string,
  label: string,
  extra: Partial<Omit<TextField, "id" | "label">> = {},
): TextField => ({ type: "text", id, label, ...extra });

export const num = (
  id: string,
  label: string,
  extra: Partial<Omit<NumberField, "id" | "label">> = {},
): NumberField => ({ type: "number", id, label, min: 0, ...extra });

export const money = (id: string, label: string, extra: Partial<Omit<NumberField, "type" | "id" | "label">> = {}): NumberField => ({
  type: "currency",
  id,
  label,
  min: 0,
  ...extra,
});

/** `showIf` helpers */
export const is = (id: string, value: string) => (v: FormValues) => v[id] === value;
export const isYes = (id: string) => is(id, "Yes");
export const all =
  (...preds: ((v: FormValues) => boolean)[]) =>
  (v: FormValues) =>
    preds.every((p) => p(v));
export const any =
  (...preds: ((v: FormValues) => boolean)[]) =>
  (v: FormValues) =>
    preds.some((p) => p(v));
export const includes = (id: string, value: string) => (v: FormValues) => {
  const cur = v[id];
  return Array.isArray(cur) && cur.includes(value);
};

/** "$2,000,000" / "$1M" / "2000000" -> 2000000 */
export function parseMoney(raw: string | undefined): number {
  if (!raw) return NaN;
  const m = raw.replace(/,/g, "").match(/([\d.]+)\s*([kKmM])?/);
  if (!m) return NaN;
  const base = Number(m[1]);
  const mult = m[2]?.toLowerCase() === "m" ? 1e6 : m[2]?.toLowerCase() === "k" ? 1e3 : 1;
  return base * mult;
}

export const US_STATES = opts(
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
);
