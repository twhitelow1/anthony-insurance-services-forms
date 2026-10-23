import "server-only";
import type { SalesforceApi } from "./api";
import { salesforceClient } from "./client";
import { salesforceConfig } from "./config";
import { ACCOUNT_FIELD_MAP, LINK_FIELDS, type OpportunityStage } from "./mapping";

/**
 * What Admin → Settings shows about Salesforce: can we sign in, which fields the app needs are
 * missing ("missing field: Account.Applications_Link__c"), the org's Opportunity stages and the
 * picklist values the mapping checks against. Cached for 5 minutes.
 */
export interface SalesforceHealth {
  configured: boolean;
  connected: boolean;
  error?: string;
  missingFields: string[];
  stages: OpportunityStage[];
  picklists: Record<string, string[]>;
  usage: { used: number; max: number } | null;
  checkedAt: Date;
}

const PICKLISTS = ["Type", "Legal_Entity__c", "Program__c", "Renewal_Status__c", "Current_Coverage__c"];

export async function checkSalesforce(api: SalesforceApi): Promise<Omit<SalesforceHealth, "configured" | "checkedAt">> {
  const [account, contact, opp] = await Promise.all([api.describe("Account"), api.describe("Contact"), api.describe("Opportunity")]);
  const has = (d: { fields: { name: string }[] }, n: string) => d.fields.some((f) => f.name.toLowerCase() === n.toLowerCase());
  const missing = [
    ...Object.values(LINK_FIELDS.Account).filter((n) => !has(account, n)).map((n) => `Account.${n}`),
    ...Object.values(LINK_FIELDS.Contact).filter((n) => !has(contact, n)).map((n) => `Contact.${n}`),
    ...Object.values(LINK_FIELDS.Opportunity).filter((n) => !has(opp, n)).map((n) => `Opportunity.${n}`),
    ...ACCOUNT_FIELD_MAP.map((m) => m.field).filter((n) => !has(account, n)).map((n) => `Account.${n}`),
  ];
  const stages = (
    await api.query<{ MasterLabel: string; IsClosed: boolean; IsWon: boolean; SortOrder: number }>(
      "SELECT MasterLabel, IsClosed, IsWon, SortOrder FROM OpportunityStage WHERE IsActive = true ORDER BY SortOrder",
    )
  ).map((r) => ({ label: r.MasterLabel, isClosed: r.IsClosed, isWon: r.IsWon, sortOrder: r.SortOrder }));
  const picklists = Object.fromEntries(
    PICKLISTS.map((n) => account.fields.find((f) => f.name === n))
      .filter((f) => !!f)
      .map((f) => [f!.name, (f!.picklistValues ?? []).filter((p) => p.active).map((p) => p.value)]),
  );
  return { connected: true, missingFields: missing, stages, picklists, usage: api.usage() };
}

let cache: { at: number; value: Promise<SalesforceHealth> } | null = null;

export function salesforceHealth({ fresh = false } = {}): Promise<SalesforceHealth> {
  if (!salesforceConfig()) {
    return Promise.resolve({ configured: false, connected: false, missingFields: [], stages: [], picklists: {}, usage: null, checkedAt: new Date() });
  }
  if (cache && !fresh && Date.now() - cache.at < 5 * 60_000) return cache.value;
  const value = checkSalesforce(salesforceClient()!)
    .then((r) => ({ ...r, configured: true, checkedAt: new Date() }))
    .catch((err) => ({
      configured: true,
      connected: false,
      error: err instanceof Error ? err.message : String(err),
      missingFields: [],
      stages: [],
      picklists: {},
      usage: null,
      checkedAt: new Date(),
    }));
  cache = { at: Date.now(), value };
  return value;
}
