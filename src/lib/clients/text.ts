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

const NAME_NOISE = /\b(the|llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited|pllc|lp|llp)\b/g;

/**
 * A business name reduced for matching: lower case, "&" as "and", punctuation and
 * LLC/Inc/Co/The dropped. "The Dance Co., LLC" and "dance co" both → "dance".
 * Migration 0011 applies the same rule in SQL.
 */
export function nameKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(NAME_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Email providers anyone can use: a shared domain there says nothing about the business. */
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com",
  "icloud.com", "me.com", "mac.com", "comcast.net", "att.net", "sbcglobal.net", "verizon.net", "protonmail.com", "proton.me",
  "gmx.com", "mail.com", "zoho.com", "yandex.com", "charter.net", "cox.net", "bellsouth.net", "earthlink.net",
]);

/** The email's domain when it belongs to a business (not gmail.com and the like), else null. */
export function businessDomain(email: string | null | undefined): string | null {
  const domain = (email ?? "").trim().toLowerCase().split("@")[1];
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}

/** A website as a bare domain: "https://www.acme.com/about" → "acme.com". */
export function websiteDomain(url: string | null | undefined): string | null {
  const s = (url ?? "").trim().toLowerCase();
  if (!s) return null;
  const host = s.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/**
 * The Lead Alchemist Company name for an Account: the Salesforce Account's name when it's linked
 * (so the two match), else the Account's own name. Individuals get a Company too, named the same way.
 */
export function laCompanyName(account: { name: string; sfSnapshot?: { name?: string | null } | null }): string {
  return account.sfSnapshot?.name?.trim() || account.name;
}
