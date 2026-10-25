import "server-only";
import type { FieldDescribe, SalesforceApi } from "@/lib/salesforce/api";
import { soqlString } from "@/lib/salesforce/api";
import { getBusinessProperties, listBusinessFields, updateBusinessProperties, type GhlObjectField } from "./client";

/**
 * Salesforce Account → Lead Alchemist Company custom fields (Program, Renewal Status, Annual
 * Premium, Inland Marine Policy, …). Each custom field on the Company is matched to the Salesforce
 * Account field with the same label (or API name), so a field added to both later is picked up
 * without code changes; "Account Owner Alias" is the Account owner's alias. Salesforce is the
 * source: a value that differs is replaced, and an empty Salesforce value never blanks Lead
 * Alchemist. Nothing is ever written to Salesforce.
 */

export interface CompanyFieldMatch {
  la: GhlObjectField;
  /** The Salesforce field read for it ("Owner.Alias" for the owner's alias). */
  sf: string;
  sfLabel: string;
}

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/__c$/, "")
    .replace(/[^a-z0-9]/g, "");

/** Lead Alchemist names that Salesforce may label differently (normalized). */
const SYNONYMS: Record<string, string[]> = {
  dbatradename: ["dba", "tradename", "dbaname", "doingbusinessas"],
  businessincomeandexplimit: ["businessincomeandexpenselimit", "businessincomelimit"],
  tenantimprovementsandbettermentsvalue: ["tenantimprovementsandbetterments", "tenantimprovementsvalue"],
};
const OWNER_ALIAS = "Owner.Alias";

/** Match each Company custom field to a Salesforce Account field (custom fields only, plus the owner alias). */
export function matchCompanyFields(laFields: GhlObjectField[], sfFields: FieldDescribe[]): { matched: CompanyFieldMatch[]; unmatched: GhlObjectField[] } {
  const custom = sfFields.filter((f) => f.name.endsWith("__c"));
  const matched: CompanyFieldMatch[] = [];
  const unmatched: GhlObjectField[] = [];
  for (const la of laFields) {
    if (la.standard || !la.fieldKey?.startsWith("business.")) continue;
    const key = norm(la.name);
    if (key === "accountowneralias" || key === "owneralias") {
      matched.push({ la, sf: OWNER_ALIAS, sfLabel: "Account Owner (Alias)" });
      continue;
    }
    if (key === "accounttype" && sfFields.some((f) => f.name === "Type")) {
      matched.push({ la, sf: "Type", sfLabel: "Account Type" });
      continue;
    }
    const want = [key, ...(SYNONYMS[key] ?? [])];
    const sf = want.map((w) => custom.find((f) => norm(f.label ?? "") === w || norm(f.name) === w)).find(Boolean);
    if (sf) matched.push({ la, sf: sf.name, sfLabel: sf.label ?? sf.name });
    else unmatched.push(la);
  }
  return { matched, unmatched };
}

/** The record's property key for a field ("business.renewal_status" → "renewal_status"). */
export const propertyKey = (f: GhlObjectField) => f.fieldKey.replace(/^business\./, "");

const read = (row: Record<string, unknown>, path: string): unknown => path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), row);

/** The Lead Alchemist value for a Salesforce value, or null when it can't go in (with why). */
export function toLaValue(f: GhlObjectField, v: unknown): { value: unknown } | { skip: string } | null {
  if (v === null || v === undefined || v === "") return null;
  const text = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v).trim();
  if (!text) return null;
  const option = (s: string) => f.options?.find((o) => o.key.toLowerCase() === s.toLowerCase() || o.label.toLowerCase() === s.toLowerCase())?.key;
  switch (f.dataType) {
    case "MONETORY":
    case "NUMERICAL": {
      const n = typeof v === "number" ? v : Number(text.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(n)) return { skip: `"${text}" isn't a number` };
      return { value: f.dataType === "MONETORY" ? { currency: "default", value: n } : n };
    }
    case "DATE":
      return /^\d{4}-\d{2}-\d{2}/.test(text) ? { value: text.slice(0, 10) } : { skip: `"${text}" isn't a date` };
    case "SINGLE_OPTIONS":
    case "RADIO": {
      const k = option(text);
      return k ? { value: k } : { skip: `"${text}" isn't one of its options in Lead Alchemist (add it there)` };
    }
    case "MULTIPLE_OPTIONS":
    case "CHECKBOX": {
      const parts = text.split(";").map((x) => x.trim()).filter(Boolean);
      const keys = parts.map(option);
      const missing = parts.filter((_, i) => !keys[i]);
      return missing.length ? { skip: `${missing.map((m) => `"${m}"`).join(", ")} isn't one of its options in Lead Alchemist (add it there)` } : { value: keys };
    }
    default:
      return { value: text };
  }
}

/** Comparable text for a stored or new value. */
const same = (a: unknown, b: unknown) => {
  const flat = (x: unknown): string =>
    x === null || x === undefined ? "" : Array.isArray(x) ? x.map(flat).sort().join(";") : typeof x === "object" && "value" in (x as object) ? flat((x as { value: unknown }).value) : String(x);
  const fa = flat(a);
  const fb = flat(b);
  if (fa === fb) return true;
  const na = Number(fa);
  const nb = Number(fb);
  if (fa && fb && Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  // Dates may come back with a time.
  return /^\d{4}-\d{2}-\d{2}/.test(fa) && fa.slice(0, 10) === fb.slice(0, 10);
};

const display = (x: unknown): string =>
  x === null || x === undefined || x === "" ? "(empty)" : Array.isArray(x) ? x.join(", ") : typeof x === "object" && "value" in (x as object) ? String((x as { value: unknown }).value) : String(x);

let fieldCache: { at: number; fields: GhlObjectField[] } | null = null;
async function companyFields() {
  if (fieldCache && !process.env.VITEST && Date.now() - fieldCache.at < 300_000) return fieldCache.fields;
  const fields = await listBusinessFields();
  fieldCache = { at: Date.now(), fields };
  return fields;
}

/** The current field matches, for the Settings page. */
export async function companyFieldMap(sf: SalesforceApi) {
  const [laFields, account] = await Promise.all([companyFields(), sf.describe("Account")]);
  const map = matchCompanyFields(laFields, account.fields);
  // Salesforce custom fields AIS Connect can see that no Company field uses (a field it can't see isn't listed at all).
  const used = new Set(map.matched.map((m) => m.sf));
  const sfUnused = account.fields.filter((f) => f.name.endsWith("__c") && !used.has(f.name)).map((f) => ({ name: f.name, label: f.label ?? f.name }));
  return { ...map, sfUnused };
}

export interface CompanyFieldsResult {
  changed: { field: string; from: string; to: string }[];
  /** Fields left as they are, with why. */
  skipped: string[];
}

/** Copy the Salesforce Account's values into its Lead Alchemist Company's matching custom fields. */
export async function pushCompanyFields(sf: SalesforceApi, sfAccountId: string, companyId: string): Promise<CompanyFieldsResult> {
  const { matched } = await companyFieldMap(sf);
  const out: CompanyFieldsResult = { changed: [], skipped: [] };
  if (!matched.length) return out;
  const select = [...new Set(["Id", ...matched.map((m) => m.sf)])];
  const [row] = await sf.query<Record<string, unknown>>(`SELECT ${select.join(", ")} FROM Account WHERE Id = ${soqlString(sfAccountId)} LIMIT 1`);
  if (!row) return out;
  const current = await getBusinessProperties(companyId);
  const write: Record<string, unknown> = {};
  for (const m of matched) {
    const next = toLaValue(m.la, read(row, m.sf));
    if (!next) continue;
    if ("skip" in next) {
      out.skipped.push(`${m.la.name}: ${next.skip}`);
      continue;
    }
    const key = propertyKey(m.la);
    const have = current[key] ?? current[m.la.fieldKey];
    if (same(have, next.value)) continue;
    write[key] = next.value;
    out.changed.push({ field: m.la.name, from: display(have), to: display(next.value) });
  }
  if (Object.keys(write).length) await updateBusinessProperties(companyId, write);
  return out;
}
