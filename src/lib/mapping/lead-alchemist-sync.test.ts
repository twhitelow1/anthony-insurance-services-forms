import { describe, expect, it, vi } from "vitest";
import { linksFor } from "@/lib/integrations/urls";
import { ensureClient, getClient, getContactByEmail } from "@/lib/clients/repo";

// Lead Alchemist stand-in. `scope` false = the token lacks the Businesses scopes (401 on Companies).
const la = vi.hoisted(() => ({
  scope: true,
  businesses: [] as { id: string; name: string }[],
  contacts: new Map<string, { id: string; email?: string; phone?: string; firstName?: string; lastName?: string; businessId?: string | null; companyName?: string; customFields?: unknown }>(),
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
      return [...la.businesses]; // a fresh list, as the API returns
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
    updateContact: async (id: string, input: Record<string, unknown>) => {
      Object.assign(la.contacts.get(id)!, input);
      return {};
    },
    createContact: async (input: { email?: string; companyName?: string }) => {
      const c = { id: `new${la.contacts.size + 1}`, email: input.email, companyName: input.companyName };
      la.contacts.set(c.id, c);
      return { contact: { id: c.id } };
    },
    listCustomFields: async () => [],
    createCustomField: async (name: string) => ({ id: `f-${name}`, name, fieldKey: name }),
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

describe("finding Lead Alchemist matches for unlinked contacts", () => {
  it("saves exact matches as suggestions, filters by them, and links them on sync", async () => {
    la.scope = true;
    const { findLaMatches, laMatchProgress } = await import("./la-matches");
    const { listAccountMap, listContactMap, syncAccountsToLeadAlchemist } = await import("./database");
    const tag = uniq();
    const withMatch = await ensureClient({ email: `m.${tag}@gmail.com`, contactName: `Mo ${tag}`, businessName: `Match Gym ${tag}` });
    const noMatch = await ensureClient({ email: `n.${tag}@gmail.com`, contactName: `No ${tag}`, businessName: `Lonely Gym ${tag}` });
    la.contacts.set(`la-${tag}`, { id: `la-${tag}`, email: `m.${tag}@gmail.com` });

    // Run until everything unlinked has been checked (other tests' contacts included).
    for (let i = 0; i < 50 && !(await findLaMatches({ timeBudgetMs: 5_000 })).done; i++);
    const progress = await laMatchProgress();
    expect(progress.remaining).toBe(0);
    expect(progress.suggested).toBeGreaterThan(0);

    const person = (await getContactByEmail(`m.${tag}@gmail.com`))!;
    expect(person).toMatchObject({ ghlContactId: null, laMatchId: `la-${tag}`, laMatchHow: "email" });
    expect((await getContactByEmail(`n.${tag}@gmail.com`))!.laMatchId).toBeNull();

    expect((await listAccountMap({ q: tag, filter: "la_suggested" })).rows.map((r) => r.id)).toEqual([withMatch]);
    expect((await listAccountMap({ q: tag, filter: "la_suggested" })).rows[0].laSuggested).toBe(1);
    expect((await listContactMap({ q: tag, filter: "la_suggested" })).rows.map((r) => r.contact.id)).toEqual([person.id]);

    await syncAccountsToLeadAlchemist([withMatch, noMatch], ACTOR, { sf: null, links: LINKS });
    expect((await getContactByEmail(`m.${tag}@gmail.com`))!.ghlContactId).toBe(`la-${tag}`);
    expect((await listAccountMap({ q: tag, filter: "la_suggested" })).rows).toHaveLength(0);
  });
});

describe("filling in Lead Alchemist from the app", () => {
  it("gives a phone-only caller their name, email and company, and never overwrites without asking", async () => {
    la.scope = true;
    const { connectSelectedContacts } = await import("./database");
    const { updateLeadAlchemistDetails } = await import("@/lib/contacts/external");
    const tag = uniq();
    const clientId = await ensureClient({ email: `call.${tag}@gmail.com`, contactName: `Cal Ler${tag}`, businessName: `Ring Gym ${tag}`, phone: "5557771234" });
    const person = (await getContactByEmail(`call.${tag}@gmail.com`))!;
    // In Lead Alchemist they only ever called: the contact is just a phone number, named after it.
    la.contacts.set(`caller-${tag}`, { id: `caller-${tag}`, phone: "+15557771234", firstName: "+1 555-777-1234" });
    const { linkLaContact } = await import("@/lib/ghl/match");
    await linkLaContact(person.id, `caller-${tag}`, ACTOR);

    await connectSelectedContacts([person.id], ACTOR);
    const la1 = la.contacts.get(`caller-${tag}`)!;
    expect(la1).toMatchObject({ firstName: "Cal", lastName: `Ler${tag}`, email: `call.${tag}@gmail.com`, companyName: `Ring Gym ${tag}` });
    expect(la1.phone).toBe("+15557771234"); // already there: left as is
    expect(JSON.stringify(la1.customFields)).toContain(`/admin/clients/${clientId}`); // link back to the app

    // A different value in Lead Alchemist stays unless staff choose to replace it.
    la1.companyName = "Old Name";
    expect((await updateLeadAlchemistDetails(person.id, ACTOR)).fields).toEqual([]);
    expect((await updateLeadAlchemistDetails(person.id, ACTOR, { replace: true })).fields).toEqual(["companyName"]);
  });
});

describe("adding a Company before its contacts", () => {
  it("creates just the Company, then adds one contact to it later", async () => {
    la.scope = true;
    const { syncAccountsToLeadAlchemist } = await import("./database");
    const tag = uniq();
    const clientId = await ensureClient({ email: `first.${tag}@gmail.com`, contactName: `First ${tag}`, businessName: `Later Gym ${tag}` });
    const { ensureContact } = await import("@/lib/clients/repo");
    const second = await ensureContact({ clientId, email: `second.${tag}@gmail.com`, name: `Second ${tag}` });

    await syncAccountsToLeadAlchemist([clientId], ACTOR, { sf: null, links: LINKS }, { companyOnly: true });
    const company = (await getClient(clientId))!.ghlCompanyId!;
    expect(la.businesses.find((b) => b.id === company)?.name).toBe(`Later Gym ${tag}`);
    expect((await getContactByEmail(`first.${tag}@gmail.com`))!.ghlContactId).toBeNull(); // no contacts touched

    await syncAccountsToLeadAlchemist([clientId], ACTOR, { sf: null, links: LINKS }, { createMissing: true, contactIds: [second.id] });
    const added = (await getContactByEmail(`second.${tag}@gmail.com`))!;
    expect(la.contacts.get(added.ghlContactId!)).toMatchObject({ businessId: company });
    expect((await getContactByEmail(`first.${tag}@gmail.com`))!.ghlContactId).toBeNull(); // only the one asked for
    // The Company is reused, not created again (the stand-in's list is shared with the sync, so count distinct IDs).
    expect(new Set(la.businesses.filter((b) => b.name === `Later Gym ${tag}`).map((b) => b.id)).size).toBe(1);
  });
});

describe("reviewing a suggested Lead Alchemist contact", () => {
  it("suggests without linking, and after 'not them' never links it and creates a new contact", async () => {
    la.scope = true;
    const { checkLaMatch, denyLaMatch } = await import("./la-matches");
    const { syncAccountsToLeadAlchemist } = await import("./database");
    const tag = uniq();
    const clientId = await ensureClient({ email: `same.${tag}@gmail.com`, contactName: `Sam ${tag}`, businessName: `Twin Studio ${tag}` });
    la.contacts.set(`other-${tag}`, { id: `other-${tag}`, email: `same.${tag}@gmail.com`, firstName: "Someone Else" });
    const person = (await getContactByEmail(`same.${tag}@gmail.com`))!;

    expect(await checkLaMatch(person.id)).toMatchObject({ id: `other-${tag}`, how: "email" });
    expect((await getContactByEmail(`same.${tag}@gmail.com`))!.ghlContactId).toBeNull(); // only suggested

    await denyLaMatch(person.id);
    await syncAccountsToLeadAlchemist([clientId], ACTOR, { sf: null, links: LINKS }, { createMissing: true, contactIds: [person.id] });
    const after = (await getContactByEmail(`same.${tag}@gmail.com`))!;
    expect(after.ghlContactId).toBeTruthy();
    expect(after.ghlContactId).not.toBe(`other-${tag}`);
    expect(after.laMatchDeniedId).toBe(`other-${tag}`);
    expect((await checkLaMatch(person.id)).id).toBeNull(); // never suggested again
  });

  it("two contacts on an account with no Company: one Company, both in it (Contacts page and the accounts filter)", async () => {
    const { ensureContact } = await import("@/lib/clients/repo");
    const { sendToLeadAlchemist } = await import("@/lib/contacts/directory");
    const { listAccountDirectory } = await import("@/lib/accounts/directory");
    const tag = uniq();
    la.scope = true;
    const clientId = await ensureClient({ email: `one.${tag}@gmail.com`, contactName: `One ${tag}`, businessName: `Two People Gym ${tag}` });
    const one = (await getContactByEmail(`one.${tag}@gmail.com`))!;
    const two = await ensureContact({ clientId, name: `Two ${tag}`, email: `two.${tag}@gmail.com` });

    // The Accounts view lists it as having contacts not in Lead Alchemist yet.
    const before = (await listAccountDirectory({ q: tag, laMissing: true })).rows;
    expect(before.map((r) => r.appId)).toEqual([clientId]);
    expect(before[0].counts.appNotInLa).toBe(2);

    const companiesBefore = la.businesses.length;
    const r = await sendToLeadAlchemist([`a:${one.id}`, `a:${two.id}`], ACTOR, { sf: null, links: LINKS }, true);
    expect(r.done).toBe(2);
    expect(la.businesses.slice(companiesBefore).map((b) => b.name)).toEqual([`Two People Gym ${tag}`]); // one Company for the account, not one per person
    const company = la.businesses.at(-1)!;
    expect(company.name).toBe(`Two People Gym ${tag}`);
    expect((await getClient(clientId))!.ghlCompanyId).toBe(company.id);
    const ids = [(await getContactByEmail(`one.${tag}@gmail.com`))!.ghlContactId, (await getContactByEmail(`two.${tag}@gmail.com`))!.ghlContactId];
    for (const id of ids) expect(la.contacts.get(id!)!.businessId).toBe(company.id);
    expect((await listAccountDirectory({ q: tag, laMissing: true })).rows).toEqual([]);
  });
});
