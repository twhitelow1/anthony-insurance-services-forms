/**
 * The Salesforce operations the sync needs, as an interface so tests (and dry run) can stand in
 * for the real REST client (client.ts). Kept small on purpose: SOQL, describe, sObject writes,
 * a file upload and a Chatter post.
 */
export interface PicklistValue {
  value: string;
  label: string;
  active: boolean;
}

export interface FieldDescribe {
  name: string;
  /** string, picklist, multipicklist, url, double, currency, date, boolean, reference, ... */
  type: string;
  length?: number;
  updateable?: boolean;
  createable?: boolean;
  picklistValues?: PicklistValue[];
}

export interface ObjectDescribe {
  name: string;
  fields: FieldDescribe[];
  /** Related lists, e.g. Account → Contacts. Only those the user can read are listed. */
  childRelationships?: { relationshipName: string | null; childSObject: string }[];
}

export interface SalesforceApi {
  /** Runs a SOQL query and follows nextRecordsUrl until every record is read (or `max` reached). */
  query<T extends Record<string, unknown>>(soql: string, opts?: { max?: number }): Promise<T[]>;
  /** One page of a query, for the resumable backfill. */
  queryPage<T extends Record<string, unknown>>(soqlOrNextUrl: string): Promise<{ records: T[]; nextRecordsUrl: string | null; totalSize?: number }>;
  describe(object: string): Promise<ObjectDescribe>;
  create(object: string, data: Record<string, unknown>): Promise<{ id: string }>;
  update(object: string, id: string, data: Record<string, unknown>): Promise<void>;
  /** ContentVersion with FirstPublishLocationId, which also creates the ContentDocumentLink to the record. */
  uploadFile(input: { parentId: string; title: string; filename: string; content: Buffer }): Promise<{ id: string }>;
  /** A Chatter text post on the record (FeedItem). */
  postFeed(parentId: string, body: string): Promise<{ id: string }>;
  /** API calls used / allowed in the last 24 hours, from the last response (null until a call is made). */
  usage(): { used: number; max: number } | null;
}

export class SalesforceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super(message);
  }
}

/** SOQL string literal: quotes and backslashes escaped. */
export const soqlString = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
