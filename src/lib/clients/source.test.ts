import { describe, expect, it } from "vitest";
import { createAccount, ensureClient, ensureContact, getClient, getContactByEmail } from "./repo";

const uniq = () => Math.random().toString(36).slice(2, 8);

describe("where accounts and contacts came from", () => {
  it("labels an application's account and person as from an application", async () => {
    const tag = uniq();
    const clientId = await ensureClient({ email: `a.${tag}@gmail.com`, contactName: `Ana ${tag}`, businessName: `Source Gym ${tag}` });
    expect((await getClient(clientId))!.source).toBe("application");
    expect((await getContactByEmail(`a.${tag}@gmail.com`))!.source).toBe("application");
  });

  it("labels Salesforce and Lead Alchemist imports, and staff additions", async () => {
    const tag = uniq();
    const sf = await createAccount({ name: `SF Co ${tag}`, sfAccountId: `001SRC${tag}` });
    expect(sf.source).toBe("salesforce");
    expect((await ensureContact({ clientId: sf.id, name: `Sal ${tag}`, email: `s.${tag}@gmail.com`, sfContactId: `003SRC${tag}` })).source).toBe("salesforce");

    const la = await createAccount({ name: `LA Co ${tag}`, source: "lead_alchemist" });
    expect(la.source).toBe("lead_alchemist");
    expect((await ensureContact({ clientId: la.id, name: `Lea ${tag}`, email: `l.${tag}@gmail.com`, ghlContactId: `la${tag}` })).source).toBe("lead_alchemist");

    const staff = await createAccount({ name: `Staff Co ${tag}` });
    expect(staff.source).toBe("manual");
    expect((await ensureContact({ clientId: staff.id, name: `Stu ${tag}`, email: `m.${tag}@gmail.com` })).source).toBe("manual");
  });

  it("never changes the source once set (a later application keeps Salesforce)", async () => {
    const tag = uniq();
    const sf = await createAccount({ name: `Kept Co ${tag}`, sfAccountId: `001KEEP${tag}` });
    const person = await ensureContact({ clientId: sf.id, name: `Kim ${tag}`, email: `k.${tag}@gmail.com`, sfContactId: `003KEEP${tag}` });
    await ensureClient({ email: `k.${tag}@gmail.com`, contactName: `Kim ${tag}`, businessName: `Kept Co ${tag}` });
    expect((await getContactByEmail(`k.${tag}@gmail.com`))!).toMatchObject({ id: person.id, source: "salesforce" });
  });
});
