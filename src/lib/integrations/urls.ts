/**
 * Every link between the app, Salesforce and Lead Alchemist, built from one place.
 * If a pattern turns out wrong, it's a one-line fix here (urls.test.ts renders each one).
 * Pure: no environment reads, so it's safe anywhere and easy to test. See links.ts for the
 * configured bases.
 */
export const URL_PATTERNS = {
  /** Salesforce Lightning record page. Object is the API name: Account, Contact, Opportunity. */
  salesforceRecord: "{salesforce}/lightning/r/{object}/{id}/view",
  /** Lead Alchemist contact. Verified: the pattern the app already used (src/lib/ghl/client.ts) and the address bar on a contact. */
  ghlContact: "{ghl}/v2/location/{locationId}/contacts/detail/{id}",
  /**
   * Lead Alchemist opportunity. Verified: HighLevel changelog "Dynamic Routing for Opportunity Modal"
   * (the platform changelog, "Dynamic Routing for Opportunity Modal").
   */
  ghlOpportunity: "{ghl}/v2/location/{locationId}/opportunities/list/{id}?tab=OpportunityDetails",
  /**
   * Lead Alchemist Company (Business). NOT VERIFIED: HighLevel doesn't document this page's address.
   * Only used once Companies are connected (docs/lead-alchemist-companies-plan.md); open a company in
   * Lead Alchemist and copy its address bar to confirm before relying on it.
   */
  ghlCompany: "{ghl}/v2/location/{locationId}/businesses/detail/{id}",
  /** The app's Client page (stable internal ID; never an email or phone). */
  appClient: "{app}/admin/clients/{id}",
  /** The app's admin page for one application. */
  appApplication: "{app}/admin/applications/{id}",
} as const;

export type UrlPattern = keyof typeof URL_PATTERNS;

const trimSlash = (s: string) => s.trim().replace(/\/+$/, "");

/** Fill a pattern. Bases are used as given (minus a trailing slash); IDs are URL-encoded. Null if anything is missing. */
export function buildUrl(pattern: UrlPattern, vars: Record<string, string | null | undefined>): string | null {
  let missing = false;
  const url = URL_PATTERNS[pattern].replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key]?.trim();
    if (!v) {
      missing = true;
      return "";
    }
    return ["salesforce", "ghl", "app"].includes(key) ? trimSlash(v) : encodeURIComponent(v);
  });
  return missing ? null : url;
}

export interface LinkBases {
  /** e.g. https://dg0000000i7rimaa.lightning.force.com */
  salesforce?: string | null;
  /** Lead Alchemist web app, e.g. https://app.leadalchemist.io */
  ghl?: string | null;
  ghlLocationId?: string | null;
  /** This app, e.g. https://anthony-insurance-services-forms.vercel.app */
  app?: string | null;
}

export type SalesforceObject = "Account" | "Contact" | "Opportunity";

/** Link builders bound to configured bases. Each returns null when the ID or a base is missing. */
export function linksFor(bases: LinkBases) {
  const ghl = { ghl: bases.ghl, locationId: bases.ghlLocationId };
  return {
    salesforce: (object: SalesforceObject, id?: string | null) => buildUrl("salesforceRecord", { salesforce: bases.salesforce, object, id }),
    ghlContact: (id?: string | null) => buildUrl("ghlContact", { ...ghl, id }),
    ghlOpportunity: (id?: string | null) => buildUrl("ghlOpportunity", { ...ghl, id }),
    ghlCompany: (id?: string | null) => buildUrl("ghlCompany", { ...ghl, id }),
    appClient: (id?: string | null) => buildUrl("appClient", { app: bases.app, id }),
    appApplication: (id?: string | null) => buildUrl("appApplication", { app: bases.app, id }),
  };
}
export type Links = ReturnType<typeof linksFor>;
