/** Pure helpers for client search and export (no database), so they're easy to test. */

/** Digits only, without a leading US country code: "+1 (555) 010-0100" → "5550100100". */
export function phoneDigits(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/** What the Clients search matches against: lower-cased names and emails, plus phone digits. */
export function clientSearchText(parts: { name?: string | null; contactName?: string | null; emails: string[]; phones: string[] }): string {
  return [parts.name, parts.contactName, ...parts.emails, ...parts.phones.map(phoneDigits)]
    .filter((s): s is string => !!s && !!s.trim())
    .map((s) => s.trim().toLowerCase())
    .join(" ");
}

/**
 * A search box entry → what to look for. Text is matched as typed (case-insensitive);
 * something that looks like a phone number is also matched on its digits, so
 * "(555) 010-0100", "555.010.0100" and "5550100100" all find the same client.
 */
export function searchTerms(q: string): { text: string; digits: string | null } {
  const text = q.trim().toLowerCase().slice(0, 100);
  const looksLikePhone = /^[\d\s().+-]+$/.test(text);
  const digits = looksLikePhone ? phoneDigits(text) : "";
  return { text, digits: digits.length >= 3 ? digits : null };
}

/** True when the client's search text matches the query (the same rule the database query applies). */
export function matchesSearch(searchText: string, q: string): boolean {
  const { text, digits } = searchTerms(q);
  if (!text) return true;
  return searchText.includes(text) || (!!digits && searchText.includes(digits));
}

/** One CSV cell: quoted when needed, and spreadsheet formulas neutralized (a leading = + - @ is prefixed with '). */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
