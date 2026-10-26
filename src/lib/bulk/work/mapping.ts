import "server-only";
import { links } from "@/lib/integrations/links";
import {
  addCompaniesToApp,
  companiesToSalesforce,
  createAccountsInSalesforce,
  createContactsInSalesforce,
  linkCompaniesToAccounts,
  linkContactsToLeadAlchemist,
  pushCompanyTags,
  syncAccountsToLeadAlchemist,
  syncContactsToLeadAlchemist,
  type BulkResult,
} from "@/lib/mapping/database";
import { salesforceClient } from "@/lib/salesforce/client";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const LA_ID = /^[A-Za-z0-9]{6,64}$/;
export const PAIR = /^[A-Za-z0-9]{6,64}:[0-9a-f-]{36}$/;

export type Tab = "accounts" | "contacts" | "companies" | "multi";
type Work = (ids: string[], actor: string, options: Record<string, string>) => Promise<BulkResult>;

async function sf() {
  const client = await salesforceClient();
  if (!client) throw new Error("Salesforce isn't connected. Add the keys in Settings → Integrations.");
  return client;
}

/** Mapping bulk buttons, by key: used by the buttons and by background runs. */
export const MAPPING_WORK: Record<string, { tab: Tab; re: RegExp; verb: string; options: string[]; work: Work }> = {
  accountsToLa: {
    tab: "accounts",
    re: UUID,
    verb: "Synced to Lead Alchemist",
    options: ["createMissing"],
    work: async (ids, actor, o) => syncAccountsToLeadAlchemist(ids, actor, { sf: await salesforceClient(), links: await links() }, { createMissing: o.createMissing === "yes" }),
  },
  accountsToSf: {
    tab: "accounts",
    re: UUID,
    verb: "Linked or created in Salesforce",
    options: [],
    work: async (ids, actor) => createAccountsInSalesforce(ids, actor, { sf: await sf(), links: await links() }),
  },
  contactsToLa: { tab: "contacts", re: UUID, verb: "Linked to Lead Alchemist", options: [], work: (ids, actor) => linkContactsToLeadAlchemist(ids, actor) },
  contactsToCompany: {
    tab: "contacts",
    re: UUID,
    verb: "Synced to Lead Alchemist",
    options: ["createMissing"],
    work: async (ids, actor, o) => syncContactsToLeadAlchemist(ids, actor, { sf: await salesforceClient(), links: await links() }, { createMissing: o.createMissing === "yes" }),
  },
  contactsToSf: {
    tab: "contacts",
    re: UUID,
    verb: "Linked or created in Salesforce",
    options: [],
    work: async (ids, actor) => createContactsInSalesforce(ids, actor, { sf: await sf(), links: await links() }),
  },
  companiesToSf: {
    tab: "companies",
    re: LA_ID,
    verb: "Linked or created in Salesforce",
    options: [],
    work: async (ids, actor) => companiesToSalesforce(ids, actor, { sf: await sf(), links: await links() }),
  },
  linkCompanies: {
    tab: "companies",
    re: PAIR,
    verb: "Linked to accounts in AIS Connect",
    options: [],
    work: (pairs, actor) =>
      linkCompaniesToAccounts(
        pairs.map((p) => p.split(":")).map(([businessId, accountId]) => ({ businessId, accountId })),
        actor,
      ),
  },
  addCompanies: { tab: "companies", re: LA_ID, verb: "Added to AIS Connect", options: [], work: (ids, actor) => addCompaniesToApp(ids, actor) },
  companyTags: { tab: "multi", re: UUID, verb: "Company tags added in Lead Alchemist", options: [], work: (ids, actor) => pushCompanyTags(ids, actor) },
};
