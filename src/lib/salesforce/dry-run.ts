import type { SalesforceApi } from "./api";

/** One write the sync would make. Values of personal fields are redacted; IDs, links and picklists are kept. */
export interface PlannedWrite {
  op: "create" | "update" | "upload" | "post";
  object: string;
  id?: string;
  fields: Record<string, string>;
}

/** Fields that can hold someone's personal details: shown as "[redacted]" in logs and dry-run plans. */
const PERSONAL = /^(Name|FirstName|LastName|Email|Phone|MobilePhone|Fax|Billing\w*|Shipping\w*|Mailing\w*|Body|VersionData|Title|PathOnClient|Contact_First_Name__c|Secondary_Email__c)$/;

export function redact(data: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, PERSONAL.test(k) ? "[redacted]" : typeof v === "string" ? v.slice(0, 255) : JSON.stringify(v)]),
  );
}

/**
 * Wraps a Salesforce client so reads go through and writes are recorded instead of sent.
 * New records get placeholder IDs ("dry-run:Account:1") so the rest of the plan can refer to them.
 */
export function dryRunApi(real: SalesforceApi, log: (w: PlannedWrite) => void = () => {}): SalesforceApi & { planned: PlannedWrite[] } {
  const planned: PlannedWrite[] = [];
  let n = 0;
  const record = (w: PlannedWrite) => {
    planned.push(w);
    log(w);
  };
  return {
    planned,
    query: (soql, opts) => real.query(soql, opts),
    queryPage: (soql) => real.queryPage(soql),
    describe: (object) => real.describe(object),
    usage: () => real.usage(),
    async create(object, data) {
      const id = `dry-run:${object}:${++n}`;
      record({ op: "create", object, id, fields: redact(data) });
      return { id };
    },
    async update(object, id, data) {
      record({ op: "update", object, id, fields: redact(data) });
    },
    async uploadFile({ parentId, filename, content }) {
      const id = `dry-run:ContentVersion:${++n}`;
      record({ op: "upload", object: "ContentVersion", id, fields: { FirstPublishLocationId: parentId, file: `${filename.split(".").pop()} file, ${content.length} bytes` } });
      return { id };
    },
    async postFeed(parentId) {
      const id = `dry-run:FeedItem:${++n}`;
      record({ op: "post", object: "FeedItem", id, fields: { ParentId: parentId, Body: "[redacted]" } });
      return { id };
    },
  };
}

export const isDryRunId = (id: string | null | undefined) => !!id && id.startsWith("dry-run:");
