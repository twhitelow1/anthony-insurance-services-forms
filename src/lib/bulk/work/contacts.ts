import "server-only";
import type { BatchResult } from "@/lib/bulk/selection-run";
import { addSelectedToApp, sendToLeadAlchemist, sendToSalesforce, updateLeadAlchemistForSelected } from "@/lib/contacts/directory";
import { links } from "@/lib/integrations/links";
import { salesforceClient } from "@/lib/salesforce/client";

type Work = (values: string[], actor: string, options: Record<string, string>) => Promise<BatchResult>;

/** Admin → Contacts bulk buttons, by key: used by the buttons and by background runs. */
export const CONTACTS_WORK: Record<string, { verb: string; options: string[]; work: Work }> = {
  addToApp: {
    verb: "Added to AIS Connect",
    options: [],
    work: async (values, actor) => addSelectedToApp(values, actor, { sf: await salesforceClient(), links: await links() }),
  },
  toLeadAlchemist: {
    verb: "Synced to Lead Alchemist",
    options: ["createMissing"],
    work: async (values, actor, o) => sendToLeadAlchemist(values, actor, { sf: await salesforceClient(), links: await links() }, o.createMissing === "yes"),
  },
  toSalesforce: {
    verb: "Linked or created in Salesforce",
    options: [],
    work: async (values, actor) => {
      const sf = await salesforceClient();
      if (!sf) throw new Error("Salesforce isn't connected. Add the keys in Settings → Integrations.");
      return sendToSalesforce(values, actor, { sf, links: await links() });
    },
  },
  updateLa: {
    verb: "Updated in Lead Alchemist",
    options: ["replace"],
    work: (values, actor, o) => updateLeadAlchemistForSelected(values, actor, o.replace === "yes"),
  },
};
