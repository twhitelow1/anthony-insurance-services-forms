import { businessDomain, nameKey, phoneDigits, websiteDomain } from "@/lib/clients/text";
import type { GhlBusiness } from "@/lib/ghl/client";

/**
 * Lead Alchemist Companies → this app's Accounts (which mirror the Salesforce Accounts): for each
 * Company, the Accounts it probably is. Pure, so it's easy to test.
 * - strong: same name (ignoring punctuation and LLC/Inc), website, phone or business email domain;
 * - possible: a similar name only (most words in common, or one name contains the other).
 */
export interface MatchAccount {
  id: string;
  name: string;
  nameKey: string;
  phones: string[];
  website: string | null;
  primaryEmail: string | null;
  sfAccountId: string | null;
  sfAccountType: string | null;
  ghlCompanyId: string | null;
}

export type MatchConfidence = "strong" | "possible";

export interface CompanySuggestion {
  account: MatchAccount;
  confidence: MatchConfidence;
  why: string[];
}

export interface CompanyMatch {
  business: GhlBusiness;
  /** The Account already linked to this Company, if any. */
  linked: MatchAccount | null;
  /** Best first; at most 5. Accounts linked to another Company are left out. */
  suggestions: CompanySuggestion[];
}

const lastTen = (p: string | null | undefined) => phoneDigits(p).slice(-10);
const words = (key: string) => new Set(key.split(" ").filter((w) => w.length > 2));

/** Share of words in common (Jaccard), 0–1. */
export function nameSimilarity(a: string, b: string) {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}

function push<K>(map: Map<K, MatchAccount[]>, key: K | null | undefined, a: MatchAccount) {
  if (!key) return;
  map.set(key, [...(map.get(key) ?? []), a]);
}

export function matchCompanies(businesses: GhlBusiness[], accounts: MatchAccount[]): CompanyMatch[] {
  const byCompany = new Map<string, MatchAccount>();
  const byName = new Map<string, MatchAccount[]>();
  const bySite = new Map<string, MatchAccount[]>();
  const byPhone = new Map<string, MatchAccount[]>();
  const byDomain = new Map<string, MatchAccount[]>();
  for (const a of accounts) {
    if (a.ghlCompanyId) byCompany.set(a.ghlCompanyId, a);
    push(byName, a.nameKey, a);
    push(bySite, websiteDomain(a.website), a);
    for (const p of a.phones) if (lastTen(p).length === 10) push(byPhone, lastTen(p), a);
    push(byDomain, businessDomain(a.primaryEmail), a);
  }

  return businesses.map((business) => {
    const linked = byCompany.get(business.id) ?? null;
    const found = new Map<string, CompanySuggestion>();
    const add = (list: MatchAccount[] | undefined, confidence: MatchConfidence, why: string) => {
      for (const account of list ?? []) {
        if (account.ghlCompanyId && account.ghlCompanyId !== business.id) continue; // linked to a different Company
        const s = found.get(account.id) ?? { account, confidence, why: [] };
        if (confidence === "strong") s.confidence = "strong";
        if (!s.why.includes(why)) s.why.push(why);
        found.set(account.id, s);
      }
    };
    const key = nameKey(business.name);
    add(byName.get(key), "strong", "same name");
    add(bySite.get(websiteDomain(business.website) ?? ""), "strong", "same website");
    const phone = lastTen(business.phone);
    if (phone.length === 10) add(byPhone.get(phone), "strong", "same phone");
    add(byDomain.get(businessDomain(business.email) ?? ""), "strong", "same email domain");
    if (key && found.size === 0) {
      const similar = accounts.filter((a) => a.nameKey && a.nameKey !== key && (nameSimilarity(a.nameKey, key) >= 0.5 || (key.length > 5 && a.nameKey.length > 5 && (a.nameKey.includes(key) || key.includes(a.nameKey)))));
      add(similar, "possible", "similar name");
    }
    const suggestions = [...found.values()]
      .filter((s) => s.account.id !== linked?.id)
      .sort((a, b) => (a.confidence === b.confidence ? b.why.length - a.why.length || a.account.name.localeCompare(b.account.name) : a.confidence === "strong" ? -1 : 1))
      .slice(0, 5);
    return { business, linked, suggestions };
  });
}

export type CompanyFilter = "unlinked" | "strong" | "possible" | "none" | "linked" | "all";

export function filterCompanyMatches(rows: CompanyMatch[], filter: CompanyFilter) {
  return rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "linked") return !!r.linked;
    if (r.linked) return false;
    if (filter === "strong") return r.suggestions[0]?.confidence === "strong";
    if (filter === "possible") return r.suggestions[0]?.confidence === "possible";
    if (filter === "none") return r.suggestions.length === 0;
    return true;
  });
}

export function companyMatchCounts(rows: CompanyMatch[]) {
  const c = { total: rows.length, linked: 0, strong: 0, possible: 0, none: 0 };
  for (const r of rows) {
    if (r.linked) c.linked++;
    else if (r.suggestions[0]?.confidence === "strong") c.strong++;
    else if (r.suggestions[0]?.confidence === "possible") c.possible++;
    else c.none++;
  }
  return c;
}
