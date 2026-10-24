import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ensureClient, getClient, getContactByEmail, resolveAccountAndContact } from "@/lib/clients/repo";
import { describeChanges, detectContactChanges } from "@/lib/contacts/external";
import { countActive, listNotifications, notificationLogFor, raiseNotification, setNotificationStatus } from "./repo";

const uniq = () => Math.random().toString(36).slice(2, 8);

describe("notifications board", () => {
  it("raises one card per situation, and logs every status change with who", async () => {
    const key = `test:${uniq()}`;
    const first = await raiseNotification({ kind: "other", title: "Check this", dedupeKey: key });
    const again = await raiseNotification({ kind: "other", title: "Check this (updated)", dedupeKey: key });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.notification.id).toBe(first.notification.id);

    await setNotificationStatus(first.notification.id, "in_progress", "staff:amy@example.com");
    await setNotificationStatus(first.notification.id, "dismissed", "staff:amy@example.com", "Not needed");
    const log = await notificationLogFor(first.notification.id);
    expect(log.map((e) => [e.action, e.toStatus, e.actor])).toEqual(
      expect.arrayContaining([
        ["created", "open", "system"],
        ["status", "in_progress", "staff:amy@example.com"],
        ["status", "dismissed", "staff:amy@example.com"],
      ]),
    );
    // Dismissed cards stay (nothing is deleted); a new one can be raised for the same key.
    expect((await raiseNotification({ kind: "other", title: "Again", dedupeKey: key })).created).toBe(true);
  });
});

describe("contact changes on an application", () => {
  it("flags a new phone against earlier applications and the Salesforce and Lead Alchemist values, without changing them", async () => {
    const email = `pat.${uniq()}@gmail.com`;
    const clientId = await ensureClient({ email, contactName: "Pat Lee", phone: "(555) 010-0100" });
    const contact = (await getContactByEmail(email))!;
    const db = await getDb();
    await db.update(schema.contacts).set({ sfPhone: "555-010-0100", laPhone: "555 999 0000" }).where(eq(schema.contacts.id, contact.id));

    const same = await detectContactChanges({ email, phone: "555.010.0100" });
    expect(same!.changes.map((c) => c.differsFrom.map((d) => d.source))).toEqual([["lead_alchemist"]]);

    const changed = await detectContactChanges({ email, phone: "(555) 222-3333" });
    expect(changed!.changes[0].differsFrom.map((d) => d.source)).toEqual(["app", "salesforce", "lead_alchemist"]);
    expect(describeChanges(changed!.changes)[0]).toContain("(555) 222-3333");
    // Nothing on file was touched.
    const after = (await getContactByEmail(email))!;
    expect(after.sfPhone).toBe("555-010-0100");
    expect(after.phones).toEqual(["(555) 010-0100"]);

    await raiseNotification({ kind: "contact_changed", title: "Phone changed", clientId, contactId: contact.id, dedupeKey: `t:${contact.id}` });
    expect(await countActive(clientId)).toBe(1);
    expect((await listNotifications({ clientId }))[0].n.title).toBe("Phone changed");
  });

  it("returns nothing for someone new", async () => {
    expect(await detectContactChanges({ email: `new.${uniq()}@gmail.com`, phone: "5550000000" })).toBeNull();
  });
});

describe("instructor applications", () => {
  it("make an individual account named after the business field, else the person", async () => {
    const withBusiness = await resolveAccountAndContact({ email: `i.${uniq()}@gmail.com`, contactName: "Ivy Ng", businessName: "Ivy Aerial LLC", individual: true });
    const a = (await getClient(withBusiness.clientId))!;
    expect(a).toMatchObject({ name: "Ivy Aerial LLC", isIndividual: true });

    const noBusiness = await resolveAccountAndContact({ email: `j.${uniq()}@gmail.com`, contactName: "Jo Park", individual: true });
    expect((await getClient(noBusiness.clientId))!).toMatchObject({ name: "Jo Park", isIndividual: true });

    const studio = await resolveAccountAndContact({ email: `k.${uniq()}@gmail.com`, contactName: "Kim Roe", businessName: "Roe Studio" });
    expect((await getClient(studio.clientId))!).toMatchObject({ name: "Roe Studio", isIndividual: false });
  });
});
