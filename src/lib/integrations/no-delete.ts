/**
 * Guard on every request to Salesforce and Lead Alchemist: the app may read, create and make
 * limited updates, but never delete. Records are deleted only in Salesforce or Lead Alchemist
 * themselves; the dashboard links there instead.
 *
 * The one DELETE the app sends is Lead Alchemist's "remove tags" call, which takes the app's own
 * status tags off a contact (a label change on the contact, not a deletion of any record).
 */
export class DeleteNotAllowedError extends Error {
  constructor(system: string, method: string, path: string) {
    super(`${system}: ${method} ${path.split("?")[0]} is blocked. AIS Connect never deletes in ${system}; delete it there instead.`);
    this.name = "DeleteNotAllowedError";
  }
}

const LA_ALLOWED_DELETES = [/^\/contacts\/[^/]+\/tags\/?$/];

/** Salesforce: no DELETE, and no composite or bulk endpoints that could carry one. */
export function assertSalesforceRequestAllowed(method: string | undefined, path: string) {
  const m = (method ?? "GET").toUpperCase();
  const p = path.split("?")[0];
  // Composite and Bulk API calls can bundle deletes inside the body, so they are blocked too.
  if (m === "DELETE" || /\/composite(\/|$)|\/jobs\/ingest/.test(p)) throw new DeleteNotAllowedError("Salesforce", m, p);
}

/** Lead Alchemist: no DELETE except removing the app's status tags from a contact. */
export function assertLeadAlchemistRequestAllowed(method: string | undefined, path: string) {
  const m = (method ?? "GET").toUpperCase();
  const p = path.split("?")[0];
  if (m === "DELETE" && !LA_ALLOWED_DELETES.some((re) => re.test(p))) throw new DeleteNotAllowedError("Lead Alchemist", m, p);
  if (/\/delete(\/|$)/i.test(p)) throw new DeleteNotAllowedError("Lead Alchemist", m, p);
}
