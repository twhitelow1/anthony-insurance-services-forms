import "server-only";
import { GhlError, ghlConfig, listCustomFields, listPipelines } from "@/lib/ghl/client";
import { salesforceClient } from "@/lib/salesforce/client";
import { checkSalesforce } from "@/lib/salesforce/health";

/** One line on the Integrations dashboard: a check and whether it passed. */
export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

const message = (err: unknown) => {
  if (err instanceof GhlError) {
    const body = err.body && typeof err.body === "object" && "message" in err.body ? String((err.body as { message: unknown }).message) : err.message;
    return `${err.status ? `${err.status}: ` : ""}${body}`;
  }
  return err instanceof Error ? err.message : String(err);
};

/** Sign in to Salesforce and read what the sync needs. Writes nothing. */
export async function testSalesforce(): Promise<Check[]> {
  const sf = await salesforceClient();
  if (!sf) return [{ label: "Keys", ok: false, detail: "Add the My Domain URL, consumer key and consumer secret." }];
  try {
    const h = await checkSalesforce(sf);
    const checks: Check[] = [
      { label: "Sign in", ok: true, detail: "Signed in as the integration user." },
      { label: "Accounts, Contacts, Opportunities", ok: true, detail: "Readable." },
      {
        label: "Link fields",
        ok: !h.missingFields.length,
        detail: h.missingFields.length ? `Missing (the app skips them): ${h.missingFields.join(", ")}` : "All present.",
      },
      { label: "Opportunity stages", ok: h.stages.length > 0, detail: h.stages.map((s) => s.label).join(", ") || "None active." },
    ];
    if (h.usage) checks.push({ label: "API use today", ok: h.usage.used / h.usage.max < 0.8, detail: `${h.usage.used} of ${h.usage.max}` });
    return checks;
  } catch (err) {
    return [{ label: "Sign in", ok: false, detail: message(err) }];
  }
}

/** Call each Lead Alchemist API the integration uses, read-only, to show which scopes the token has. */
export async function testLeadAlchemist(): Promise<Check[]> {
  const cfg = await ghlConfig();
  if (!cfg) return [{ label: "Keys", ok: false, detail: "Add the Private Integration token and the location (sub-account) ID." }];
  const { searchContacts, listBusinesses } = await import("@/lib/ghl/client");
  const run = async (label: string, scope: string, fn: () => Promise<string>): Promise<Check> => {
    try {
      return { label, ok: true, detail: await fn() };
    } catch (err) {
      const m = message(err);
      return { label, ok: false, detail: /401|403|scope|authorized/i.test(m) ? `Not allowed: add the ${scope} scope to the token. (${m})` : m };
    }
  };
  return Promise.all([
    run("Contacts", "View/Edit Contacts", async () => `Can search contacts (${(await searchContacts({ query: "a", limit: 1 })).length ? "found some" : "none matched a test search"}).`),
    run("Custom fields", "View/Edit Custom Fields", async () => `${(await listCustomFields("contact")).length} contact fields.`),
    run("Opportunities", "View/Edit Opportunities", async () => `${(await listPipelines()).length} pipelines.`),
    run("Companies", "Businesses (view, edit)", async () => `${(await listBusinesses(100)).length} Companies read.`),
  ]);
}
