/**
 * What a Lead Alchemist sync did with each contact. Every contact lands in exactly one bucket, so
 * the buckets add up to the contacts the sync looked at.
 */
export interface ContactTally {
  /** Already in Lead Alchemist (exact email or phone match, or linked before) and in the Company. */
  linked: number;
  /** New in Lead Alchemist, in the Company. */
  created: number;
  /** Not in Lead Alchemist, and "Create missing contacts" was unticked. */
  notCreated: number;
  /** Not in Lead Alchemist, and no email or phone to create them with. */
  noEmailOrPhone: number;
  /** In Lead Alchemist but already in another Company (left there). */
  otherCompany: number;
  /** Their email or phone matches more than one Lead Alchemist contact. */
  severalMatches: number;
  /** Linked, but couldn't be put in the Company (the token lacks the Businesses scopes). */
  noCompanyAccess: number;
  /** Lead Alchemist refused or something broke. */
  failed: number;
}

export const SKIP_REASONS = {
  notCreated: "not in Lead Alchemist and \"Create missing contacts\" was unticked",
  noEmailOrPhone: "no email or phone",
  otherCompany: "already in another Company (left there)",
  severalMatches: "email or phone matches more than one Lead Alchemist contact",
  noCompanyAccess: "couldn't be put in the Company (token lacks the Businesses scopes)",
} as const satisfies Partial<Record<keyof ContactTally, string>>;

export type SkipReason = keyof typeof SKIP_REASONS;

export const emptyTally = (): ContactTally => ({ linked: 0, created: 0, notCreated: 0, noEmailOrPhone: 0, otherCompany: 0, severalMatches: 0, noCompanyAccess: 0, failed: 0 });

export function addTally(a: ContactTally | undefined, b: ContactTally | undefined): ContactTally | undefined {
  if (!b) return a;
  const out = { ...(a ?? emptyTally()) };
  for (const k of Object.keys(out) as (keyof ContactTally)[]) out[k] += b[k] ?? 0;
  return out;
}

export const skippedOf = (t: ContactTally) => (Object.keys(SKIP_REASONS) as SkipReason[]).reduce((n, k) => n + t[k], 0);
export const totalOf = (t: ContactTally) => t.linked + t.created + skippedOf(t) + t.failed;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "3 contacts: 1 linked, 1 created, 1 skipped (no email or phone)". */
export function describeTally(t: ContactTally): string {
  const parts = [`${t.linked.toLocaleString("en-US")} linked`, `${t.created.toLocaleString("en-US")} created`];
  const skips = (Object.keys(SKIP_REASONS) as SkipReason[]).filter((k) => t[k]).map((k) => `${t[k].toLocaleString("en-US")} ${SKIP_REASONS[k]}`);
  if (skips.length) parts.push(`${skippedOf(t).toLocaleString("en-US")} skipped (${skips.join("; ")})`);
  if (t.failed) parts.push(`${t.failed.toLocaleString("en-US")} failed`);
  return `${plural(totalOf(t), "contact")}: ${parts.join(", ")}`;
}
