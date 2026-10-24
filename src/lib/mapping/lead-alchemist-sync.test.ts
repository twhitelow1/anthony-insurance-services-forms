import { describe, expect, it, vi } from "vitest";
import { linksFor } from "@/lib/integrations/urls";
import { ensureClient, getClient, getContactByEmail } from "@/lib/clients/repo";

// Lead Alchemist stand-in. `scope` false = the token lacks the Businesses scopes (401 on Companies).
const la = vi.hoisted(() => ({
  scope: true,
  businesses: [] as { id: string; name: string }[],
  contacts: new Map<string, { id: string; email?: string; phone?: string; businessId?: string | null; companyName?: string }>(),
  attached: [] as { ids: string[]; businessId: string }[],
}));
vi.mock("@/lib/ghl/client", async (orig) => {
  const real = await orig<typeof import("@/lib/ghl/client")>();
  const denied = (path: string) => new real.GhlError(real.leadAlchemistErrorMessage("GET", path, 401), 401, null);
  return {
    ...real,
    ghlConfig: async () => ({ token: "t", locationId: "LOC1" }),
    listBusinesses: async () => {
      if (!la.scope) throw denied("/businesses/?locationId=LOC1");
      return la.businesses;
    },
    createBusiness: async (input: { name: string }) => {
      if (!la.scope) throw denied("/businesses/");
      const b = { id: `biz${la.businesses.length + 1}`, name: input.name };
      la.businesses.push(b);
      return b;
    },
    findContactByEmail: async (email: string) => [...la.contacts.values()].find((c) => c.email === email) ?? null,
    findContactByPhone: async () => null,
    getContact: async (id: string) => la.contacts.get(id) ?? null,
    upsertContact: async (input: { email?: string; companyName?: string }) => {
      const c = { id: `con${la.contacts.size + 1}`, email: input.email, companyName: input.companyName };
      la.contacts.set(c.id, c);
      return { new: true, contact: { id: c.id } };
    },
    addContactsToBusiness: async (ids: string[], businessId: string) => {
      if (!la.scope) throw denied("/contacts/bulk/business");
      la.attached.push({ ids, businessId });
      for (const id of ids) la.contacts.get(id)!.businessId = businessId;
    },
    upsertGhlLinkFields: async () => ({ missing: [] }),
  };
});

const LINKS = linksFor({ salesforce: null, ghl: "https://app.leadalchemist.io", ghlLocationId: "LOC1", app: "https://forms.example.com" });
const uniq = () => Math.random().toString(36).slice(2, 8);
const ACTOR = "staff:amy@anthonyinsuranceservices.com";

describe("accounts → Lead Alchemist Companies and contacts", () => {
  it("creates the Company, creates missing contacts when asked, and puts them in it", async () => {
    la.scope = true;
    const { syncAccountsToLeadAlchemist } = await import("./database");
    const tag = uniq();
    const clientId = await ensureClient({ email: `own.${tag}@gmail.com`, contactName: `Own ${tag}`, businessName: `Flip Gym ${tag}` });

    const without = await syncAccountsToLeadAlchemist([clientId], ACTOR, { sf: null, links: LINKS });
    expect(without.notes.join(" ")).toMatch(/not in Lead Alchemist \(tick "Create missing contacts"/);
    expect((await getContactByEmail(`own.${tag}@gmail.com`))!.ghlContactId).toBeNull();

    const r = await syncAccountsToLeadAlchemist([clientId], ACTOR, { sf: null, links: LINKS }, { createMissing: true });
    expect(r.done).toBe(1);
    const company = (await getClient(clientId))!.ghlCompanyId!;
    expect(la.businesses.find((b) => b.id === company)?.name).toBe(`Flip Gym ${tag}`);
    const person = (await getContactByEmail(`own.${tag}@gmail.com`))!;
    expect(la.contacts.get(person.ghlContactId!)).toMatchObject({ businessId: company, companyName: `Flip Gym ${tag}` });
  });

  it("still links and creates contacts when the token can't use Companies, and says how to fix it", async () => {
    la.scope = false;
    const { syncAccountsToLeadAlchemist } = await import("./database");
    const tag = uniq();
    const clientId = await ensureClient({ email: `b.${tag}@gmail.com`, contactName: `Bo ${tag}`, businessName: `Blocked Gym ${tag}` });
    const r = await syncAccountsToLeadAlchemist([clientId], ACTOR, { sf: null, links: LINKS }, { createMissing: true });
    expect(r.notes[0]).toMatch(/Companies scopes/);
    expect((await getClient(clientId))!.ghlCompanyId).toBeNull();
    expect((await getContactByEmail(`b.${tag}@gmail.com`))!.ghlContactId).toBeTruthy();
  });

  it("explains a 401 on Companies in plain words", async () => {
    const { leadAlchemistErrorMessage } = await vi.importActual<typeof import("@/lib/ghl/client")>("@/lib/ghl/client");
    expect(leadAlchemistErrorMessage("GET", "/businesses/?locationId=X", 401)).toMatch(/Companies scopes.*businesses\.readonly and businesses\.write/);
    expect(leadAlchemistErrorMessage("GET", "/contacts/abc", 500)).toBe("Lead Alchemist GET /contacts/abc failed: 500");
  });
});
