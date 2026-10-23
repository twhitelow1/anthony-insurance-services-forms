import type { FieldDescribe, ObjectDescribe, SalesforceApi } from "@/lib/salesforce/api";
import type { GhlLinkWriter } from "@/lib/ghl/links";

/**
 * In-memory Salesforce for tests: answers exactly the SOQL the sync and backfill send,
 * stores created records, and counts every write so tests can prove idempotency.
 */
type Rec = Record<string, unknown> & { Id: string };

const f = (name: string, type = "string", extra: Partial<FieldDescribe> = {}): FieldDescribe => ({ name, type, createable: true, updateable: true, ...extra });
const pick = (values: string[]) => values.map((v) => ({ value: v, label: v, active: true }));

export const LINK_FIELD_NAMES = {
  Account: ["Applications_Link__c", "LA_Company_Link__c", "LA_Contact_Link__c", "LA_Opportunity_Link__c"],
  Contact: ["LA_Contact_Link__c", "Applications_Link__c"],
  Opportunity: ["LA_Opportunity_Link__c", "Application_Link__c"],
};

export function describes({ withoutFields = [] as string[] } = {}): Record<string, ObjectDescribe> {
  const drop = (o: string, fields: FieldDescribe[]) => ({ name: o, fields: fields.filter((x) => !withoutFields.includes(`${o}.${x.name}`)) });
  return {
    Account: drop("Account", [
      f("Id", "id", { createable: false, updateable: false }),
      f("Name"),
      f("Type", "picklist", { picklistValues: pick(["Prospect", "Customer"]) }),
      f("Phone", "phone"),
      f("BillingStreet", "textarea"),
      f("BillingCity"),
      f("BillingState"),
      f("BillingPostalCode"),
      f("Website", "url"),
      f("Legal_Entity__c", "picklist", { picklistValues: pick(["Individual", "LLC", "Corporation"]) }),
      f("Program__c", "picklist", { picklistValues: pick(["Aerial Instructor", "Gymnastics"]) }),
      f("Number_of_Participants__c", "double"),
      f("GL_Aggregate_Limit__c", "double"),
      f("Effective_Date__c", "date"),
      f("Contact_First_Name__c"),
      ...LINK_FIELD_NAMES.Account.map((n) => f(n, "url", { length: 255 })),
    ]),
    Contact: drop("Contact", [
      f("Id", "id", { createable: false, updateable: false }),
      f("AccountId", "reference"),
      f("FirstName"),
      f("LastName"),
      f("Email", "email"),
      f("Phone", "phone"),
      f("MailingStreet", "textarea"),
      f("MailingCity"),
      f("MailingState"),
      f("MailingPostalCode"),
      ...LINK_FIELD_NAMES.Contact.map((n) => f(n, "url", { length: 255 })),
    ]),
    Opportunity: drop("Opportunity", [
      f("Id", "id", { createable: false, updateable: false }),
      f("AccountId", "reference"),
      f("Name"),
      f("StageName", "picklist", { picklistValues: pick(["Prospecting", "Proposal", "Closed Won", "Closed Lost"]) }),
      f("CloseDate", "date"),
      ...LINK_FIELD_NAMES.Opportunity.map((n) => f(n, "url", { length: 255 })),
    ]),
  };
}

const PREFIX: Record<string, string> = { Account: "001", Contact: "003", Opportunity: "006", ContentVersion: "068", FeedItem: "0D5" };
const unq = (s: string) => s.replace(/\\'/g, "'").replace(/\\\\/g, "\\");

export function mockSalesforce(
  opts: { withoutFields?: string[]; failWith?: () => Error | null; usage?: () => { used: number; max: number } } = {},
) {
  const records: Record<string, Rec[]> = { Account: [], Contact: [], Opportunity: [], ContentVersion: [], FeedItem: [] };
  const writes: { op: string; object: string; id: string; data: Record<string, unknown> }[] = [];
  const queries: string[] = [];
  const d = describes(opts);
  let n = 0;
  const fail = () => {
    const e = opts.failWith?.();
    if (e) throw e;
  };
  const byId = (id: string) => Object.values(records).flat().find((r) => r.Id === id);

  const run = (soql: string): Rec[] => {
    queries.push(soql);
    let m: RegExpMatchArray | null;
    if ((m = soql.match(/FROM Contact WHERE AccountId = '((?:[^'\\]|\\.)*)' AND Email = '((?:[^'\\]|\\.)*)'/)))
      return records.Contact.filter((c) => c.AccountId === unq(m![1]) && String(c.Email).toLowerCase() === unq(m![2]).toLowerCase());
    if ((m = soql.match(/FROM Contact WHERE Email = '((?:[^'\\]|\\.)*)'/)))
      return records.Contact.filter((c) => String(c.Email ?? "").toLowerCase() === unq(m![1]).toLowerCase()).map((c) => ({
        ...c,
        Account: c.AccountId ? { Name: byId(String(c.AccountId))?.Name } : null,
      }));
    if ((m = soql.match(/FROM Account WHERE Name = '((?:[^'\\]|\\.)*)'/))) return records.Account.filter((a) => a.Name === unq(m![1]));
    if ((m = soql.match(/FROM Account WHERE Id = '((?:[^'\\]|\\.)*)'/))) return records.Account.filter((a) => a.Id === unq(m![1]));
    if (/FROM OpportunityStage/.test(soql))
      return [
        { Id: "s1", MasterLabel: "Prospecting", IsClosed: false, IsWon: false, SortOrder: 1 },
        { Id: "s2", MasterLabel: "Proposal", IsClosed: false, IsWon: false, SortOrder: 2 },
        { Id: "s3", MasterLabel: "Closed Won", IsClosed: true, IsWon: true, SortOrder: 3 },
        { Id: "s4", MasterLabel: "Closed Lost", IsClosed: true, IsWon: false, SortOrder: 4 },
      ];
    if (/FROM Account\b/.test(soql) && /\(SELECT/.test(soql)) {
      // Backfill: accounts with their contacts, ordered by Id.
      const after = soql.match(/WHERE Id > '([^']+)'/)?.[1];
      return records.Account.filter((a) => !after || a.Id > after)
        .sort((a, b) => a.Id.localeCompare(b.Id))
        .map((a) => ({ ...a, Contacts: { records: records.Contact.filter((c) => c.AccountId === a.Id) } }));
    }
    throw new Error(`mock Salesforce: unexpected query ${soql}`);
  };

  const api: SalesforceApi = {
    async query<T extends Record<string, unknown>>(soql: string, o: { max?: number } = {}) {
      fail();
      const out = run(soql) as unknown as T[];
      return o.max ? out.slice(0, o.max) : out;
    },
    async queryPage<T extends Record<string, unknown>>(soql: string) {
      fail();
      return { records: run(soql) as unknown as T[], nextRecordsUrl: null };
    },
    async describe(object) {
      fail();
      return d[object];
    },
    async create(object, data) {
      fail();
      const id = `${PREFIX[object] ?? "a00"}MOCK${String(++n).padStart(9, "0")}`;
      records[object] ??= [];
      records[object].push({ ...data, Id: id });
      writes.push({ op: "create", object, id, data });
      return { id };
    },
    async update(object, id, data) {
      fail();
      const r = records[object]?.find((x) => x.Id === id);
      if (!r) throw new Error(`mock Salesforce: no ${object} ${id}`);
      Object.assign(r, data);
      writes.push({ op: "update", object, id, data });
    },
    async uploadFile({ parentId, title, filename, content }) {
      return api.create("ContentVersion", { Title: title, PathOnClient: filename, FirstPublishLocationId: parentId, size: content.length });
    },
    async postFeed(parentId, body) {
      return api.create("FeedItem", { ParentId: parentId, Body: body, Type: "TextPost" });
    },
    usage: () => opts.usage?.() ?? { used: writes.length, max: 15000 },
  };
  const creates = (object?: string) => writes.filter((w) => w.op === "create" && (!object || w.object === object));
  return { api, records, writes, queries, creates };
}

export function mockGhlLinks() {
  const calls: { kind: string; id: string; data: unknown }[] = [];
  const writer: GhlLinkWriter = {
    async contactLinks(id, data) {
      calls.push({ kind: "contact", id, data });
      return { missing: [] };
    },
    async opportunityLinks(id, data) {
      calls.push({ kind: "opportunity", id, data });
      return { missing: [] };
    },
    async note(id, body) {
      calls.push({ kind: "note", id, data: body });
    },
  };
  return { writer, calls };
}
