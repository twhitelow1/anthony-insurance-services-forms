import "server-only";
import { accountsToLeadAlchemist, accountsToSalesforce, addAccountsToApp, linkSuggestedMatches, type AccountSyncOptions } from "@/lib/accounts/directory";
import type { BatchResult } from "@/lib/bulk/selection-run";
import { links } from "@/lib/integrations/links";
import { salesforceClient } from "@/lib/salesforce/client";

type Work = (keys: string[], actor: string, options: Record<string, string>) => Promise<BatchResult>;

const syncOptions = (o: Record<string, string>): AccountSyncOptions => ({ useSuggested: o.useSuggested === "yes", createMissing: o.createMissing === "yes" });
const deps = async () => ({ sf: await salesforceClient(), links: await links() });

/** Accounts → Across all three bulk buttons, by key: used by the buttons and by background runs. */
export const ACCOUNTS_WORK: Record<string, { verb: string; options: string[]; work: Work }> = {
  addToApp: { verb: "Added to AIS Connect", options: ["useSuggested"], work: async (k, a, o) => addAccountsToApp(k, a, await deps(), syncOptions(o)) },
  toLeadAlchemist: {
    verb: "Synced to Lead Alchemist",
    options: ["useSuggested", "createMissing"],
    work: async (k, a, o) => accountsToLeadAlchemist(k, a, await deps(), syncOptions(o)),
  },
  toSalesforce: { verb: "Linked or created in Salesforce", options: ["useSuggested"], work: async (k, a, o) => accountsToSalesforce(k, a, await deps(), syncOptions(o)) },
  linkSuggested: { verb: "Linked to suggested matches", options: [], work: async (k, a) => linkSuggestedMatches(k, a, await deps()) },
};
