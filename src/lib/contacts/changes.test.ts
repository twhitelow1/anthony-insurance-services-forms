import { describe, expect, it } from "vitest";
import { ensureClient, ensureContact, getContactByEmail, setPrimaryContact } from "@/lib/clients/repo";
import { changesForContacts, listContactChanges, recordContactChanges } from "./changes";

const uniq = () => Math.random().toString(36).slice(2, 8);
const ACTOR = "staff:amy@anthonyinsuranceservices.com";

describe("contact change log", () => {
  it("records only values that changed, newest first, and finds them by name or field", async () => {
    const tag = uniq();
    const clientId = await ensureClient({ email: `c.${tag}@gmail.com`, contactName: `Cam ${tag}`, businessName: `Log Gym ${tag}` });
    const cam = (await getContactByEmail(`c.${tag}@gmail.com`))!;
    await recordContactChanges(
      cam.id,
      clientId,
      [
        { system: "salesforce", direction: "read", field: "Phone", oldValue: "555-0100", newValue: "555-0100" }, // unchanged: skipped
        { system: "salesforce", direction: "read", field: "Phone", oldValue: "555-0100", newValue: "555-0199" },
      ],
      "salesforce:change",
    );
    await recordContactChanges(cam.id, clientId, [{ system: "lead_alchemist", direction: "wrote", field: "Contact Type", oldValue: "lead", newValue: "Customer" }], ACTOR);

    const mine = (await changesForContacts([cam.id])).get(cam.id)!;
    expect(mine.map((c) => [c.field, c.oldValue, c.newValue])).toEqual([
      ["Contact Type", "lead", "Customer"],
      ["Phone", "555-0100", "555-0199"],
    ]);
    expect((await listContactChanges({ q: `Cam ${tag}` })).total).toBe(2);
    expect((await listContactChanges({ q: `Cam ${tag}`, system: "lead_alchemist" })).rows.map((r) => r.change.newValue)).toEqual(["Customer"]);
  });

  it("logs a tier swap on both people", async () => {
    const tag = uniq();
    const clientId = await ensureClient({ email: `p.${tag}@gmail.com`, contactName: `Pat ${tag}`, businessName: `Tier Log ${tag}` });
    const pat = (await getContactByEmail(`p.${tag}@gmail.com`))!;
    const sam = await ensureContact({ clientId, name: `Sam ${tag}`, email: `s.${tag}@gmail.com` });
    await setPrimaryContact(clientId, sam.id, ACTOR);
    const log = await changesForContacts([pat.id, sam.id]);
    expect(log.get(sam.id)!.find((c) => c.field === "Client tier")).toMatchObject({ oldValue: "Secondary", newValue: "Primary", actor: ACTOR });
    expect(log.get(pat.id)!.find((c) => c.field === "Client tier")).toMatchObject({ oldValue: "Primary", newValue: "Secondary" });
  });
});
