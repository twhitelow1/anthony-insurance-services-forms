import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { SyncJob } from "@/lib/db/schema";
import { addClientEvent } from "@/lib/clients/repo";
import { salesforceClient } from "./client";
import { refreshAccountFromSalesforce } from "./refresh";

/**
 * Salesforce → AIS Connect: when an Account or Contact changes in Salesforce, a Flow there sends
 * an Outbound Message to AIS Connect's webhook. AIS Connect acknowledges it at once, queues it,
 * then reads the record back through the API and updates its own copy (the account's Salesforce
 * values and Account Type, new Contacts, each person's Salesforce email and phone, and the
 * Salesforce lists). Nothing is written to Salesforce or Lead Alchemist from here.
 */

export type InboundObject = "Account" | "Contact";
export interface InboundItem {
  object: InboundObject;
  id: string;
}

const SF_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/** The secret part of the webhook address, derived from the app's own key (nothing to store or paste). */
export function salesforceWebhookToken(): string | null {
  const own = process.env.INTEGRATIONS_KEY?.trim();
  const base = own && own.length >= 32 ? own : process.env.SESSION_SECRET;
  if (!base || base.length < 32) return null;
  return createHmac("sha256", base).update("salesforce-outbound-webhook-v1").digest("base64url").slice(0, 32);
}

export function isWebhookToken(candidate: string): boolean {
  const token = salesforceWebhookToken();
  if (!token || candidate.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
}

/** The Accounts and Contacts named in an Outbound Message (SOAP). Anything else is ignored. */
export function parseOutboundMessage(xml: string): { organizationId: string | null; items: InboundItem[] } {
  const organizationId = xml.match(/<(?:\w+:)?OrganizationId>([^<]+)</)?.[1]?.trim() ?? null;
  const items: InboundItem[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?sObject\b[^>]*xsi:type="(?:\w+:)?(Account|Contact)"[^>]*>([\s\S]*?)<\/(?:\w+:)?sObject>/g)) {
    const id = m[2].match(/<(?:\w+:)?Id>([^<]+)</)?.[1]?.trim();
    if (id && SF_ID.test(id) && !items.some((i) => i.id === id)) items.push({ object: m[1] as InboundObject, id });
  }
  return { organizationId, items };
}

/** What Salesforce expects back; without it, Salesforce retries the message for up to 24 hours. */
export const outboundAck = (ok: boolean) =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><notificationsResponse xmlns="http://soap.sforce.com/2005/09/outbound"><Ack>${ok}</Ack></notificationsResponse></soapenv:Body></soapenv:Envelope>`;

/** Queue the changes (one open job per record: a burst of edits is read back once). */
export async function enqueueInbound(items: InboundItem[]): Promise<number> {
  if (!items.length) return 0;
  const db = await getDb();
  const targets = items.map((i) => `${i.object}:${i.id}`);
  const open = await db
    .select({ targetId: schema.syncJobs.targetId })
    .from(schema.syncJobs)
    .where(and(eq(schema.syncJobs.kind, "salesforce_inbound"), inArray(schema.syncJobs.targetId, targets), eq(schema.syncJobs.status, "pending")));
  const fresh = targets.filter((t) => !open.some((o) => o.targetId === t));
  if (fresh.length) await db.insert(schema.syncJobs).values(fresh.map((targetId) => ({ kind: "salesforce_inbound" as const, targetId })));
  return fresh.length;
}

/** Read one changed record back from Salesforce and update AIS Connect. Throws to retry later. */
export async function processInbound(job: Pick<SyncJob, "targetId">): Promise<string> {
  const [object, id] = job.targetId.split(":") as [InboundObject, string];
  const sf = await salesforceClient();
  if (!sf) throw new Error("Salesforce isn't connected; the change waits until it is.");
  const db = await getDb();
  const actor = "salesforce:change";
  const { refreshSalesforceAccountCopy } = await import("@/lib/accounts/directory");
  const { refreshSalesforceContactCopy } = await import("@/lib/contacts/directory");
  const { refreshContactExternal } = await import("@/lib/contacts/external");

  const refreshAccounts = async (sfAccountId: string) => {
    const linked = await db
      .select({ id: schema.clients.id, name: schema.clients.name })
      .from(schema.clients)
      .where(and(eq(schema.clients.sfAccountId, sfAccountId), isNull(schema.clients.mergedInto)));
    for (const c of linked) {
      await refreshAccountFromSalesforce(c.id, sf, actor);
      await addClientEvent(c.id, "sf_synced", actor, { message: "Updated from Salesforce (a change was made there)" });
    }
    return linked.length;
  };

  if (object === "Account") {
    const [row] = await refreshSalesforceAccountCopy(sf, [id]);
    const n = await refreshAccounts(id);
    return row ? `Account ${row.name}: ${n} AIS Connect account${n === 1 ? "" : "s"} updated` : `Account ${id} not found in Salesforce`;
  }
  const [row] = await refreshSalesforceContactCopy(sf, [id]);
  const people = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.sfContactId, id));
  for (const p of people) await refreshContactExternal(p.id, actor);
  // A new Contact under an Account AIS Connect has: refreshing the Account brings them in.
  if (!people.length && row?.companyId) await refreshAccounts(row.companyId);
  return row ? `Contact ${row.name}: ${people.length ? "updated" : "copied"}` : `Contact ${id} not found in Salesforce`;
}

/** For Settings → Integrations: the last few changes Salesforce sent, and how many wait or failed. */
export async function inboundActivity() {
  const db = await getDb();
  const { desc } = await import("drizzle-orm");
  const j = schema.syncJobs;
  const [recent, pending, failed] = await Promise.all([
    db.select().from(j).where(eq(j.kind, "salesforce_inbound")).orderBy(desc(j.updatedAt)).limit(5),
    db.$count(j, and(eq(j.kind, "salesforce_inbound"), eq(j.status, "pending"))),
    db.$count(j, and(eq(j.kind, "salesforce_inbound"), eq(j.status, "failed"))),
  ]);
  return { recent, pending, failed };
}
