import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ensureClient, getClient } from "@/lib/clients/repo";
import { mockSalesforce } from "@/test/salesforce-mock";

const sf = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), salesforceClient: async () => sf.api }));

const uniq = () => Math.random().toString(36).slice(2, 8);

// What a Salesforce Outbound Message looks like (two notifications: an Account and a Contact).
const message = (accountId: string, contactId: string) => `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <soapenv:Body>
  <notifications xmlns="http://soap.sforce.com/2005/09/outbound">
   <OrganizationId>00D000000000001AAA</OrganizationId>
   <ActionId>04k000000000001AAA</ActionId>
   <Notification>
    <Id>04l000000000001AAA</Id>
    <sObject xsi:type="sf:Account" xmlns:sf="urn:sobject.enterprise.soap.sforce.com">
     <sf:Id>${accountId}</sf:Id>
    </sObject>
   </Notification>
   <Notification>
    <Id>04l000000000002AAA</Id>
    <sObject xsi:type="sf:Contact" xmlns:sf="urn:sobject.enterprise.soap.sforce.com">
     <sf:Id>${contactId}</sf:Id>
    </sObject>
   </Notification>
  </notifications>
 </soapenv:Body>
</soapenv:Envelope>`;

describe("changes made in Salesforce", () => {
  it("reads the Accounts and Contacts out of an Outbound Message and answers with an Ack", async () => {
    const { parseOutboundMessage, outboundAck } = await import("./inbound");
    expect(parseOutboundMessage(message("001000000000001AAA", "003000000000001AAA"))).toEqual({
      organizationId: "00D000000000001AAA",
      items: [
        { object: "Account", id: "001000000000001AAA" },
        { object: "Contact", id: "003000000000001AAA" },
      ],
    });
    expect(parseOutboundMessage("<not soap/>").items).toEqual([]);
    expect(outboundAck(true)).toContain("<Ack>true</Ack>");
  });

  it("only accepts its own secret address", async () => {
    const { isWebhookToken, salesforceWebhookToken } = await import("./inbound");
    const token = salesforceWebhookToken()!;
    expect(token).toHaveLength(32);
    expect(isWebhookToken(token)).toBe(true);
    expect(isWebhookToken(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"))).toBe(false);
    expect(isWebhookToken("short")).toBe(false);
  });

  it("queues each change once and reads the Account back: new Type, new Contact", async () => {
    const { enqueueInbound } = await import("./inbound");
    const { runDueJobs } = await import("./jobs");
    const tag = uniq();
    const mock = mockSalesforce();
    sf.api = mock.api;
    const acct = await mock.api.create("Account", { Name: `Hook Gym ${tag}`, Type: "Prospect" });
    const clientId = await ensureClient({ email: `h.${tag}@gmail.com`, contactName: `Hu ${tag}`, businessName: `Hook Gym ${tag}` });
    const db = await getDb();
    await db.update(schema.clients).set({ sfAccountId: acct.id, sfAccountType: "Prospect" }).where(eq(schema.clients.id, clientId));

    // In Salesforce: the Type changes and someone is added to the Account.
    await mock.api.update("Account", acct.id, { Type: "Customer" });
    await mock.api.create("Contact", { AccountId: acct.id, FirstName: "New", LastName: `Person${tag}`, Email: `new.${tag}@gmail.com` });

    expect(await enqueueInbound([{ object: "Account", id: acct.id }])).toBe(1);
    expect(await enqueueInbound([{ object: "Account", id: acct.id }])).toBe(0); // a burst of edits is read once
    const results = await runDueJobs(20);
    expect(results.every((r) => !r.error)).toBe(true);

    expect((await getClient(clientId))!.sfAccountType).toBe("Customer");
    const people = await db.select().from(schema.contacts).where(eq(schema.contacts.clientId, clientId));
    expect(people.map((p) => p.primaryEmail)).toContain(`new.${tag}@gmail.com`);
    expect(people.find((p) => p.primaryEmail === `new.${tag}@gmail.com`)!.source).toBe("salesforce");
    const [copy] = await db.select().from(schema.directoryAccounts).where(eq(schema.directoryAccounts.id, acct.id));
    expect(copy.type).toBe("Customer");
    const events = await db.select().from(schema.clientEvents).where(eq(schema.clientEvents.clientId, clientId));
    expect(events.some((e) => /Updated from Salesforce/.test(e.message ?? ""))).toBe(true);
  });
});
